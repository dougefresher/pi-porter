/**
 * Child process entry point for a long-lived Pi agent session.
 *
 * Lifecycle:
 *   1. Parent spawns this process with Bun.spawn({ ipc: ... })
 *   2. Parent sends { type: 'init', sessionKey, cwd, sessionDir }
 *   3. Worker creates Pi agent session (expensive, one-time)
 *   4. Worker sends { type: 'ready' }
 *   5. Parent sends { type: 'prompt', text } for each request
 *   6. Worker streams { type: 'delta', text } and sends { type: 'done', result }
 *
 * The session never disposes — it lives for the lifetime of this process.
 * The parent kills via SIGTERM when evicting from the LRU pool.
 */

import { mkdir } from 'node:fs/promises';
import { createAgentSession, SessionManager } from '@earendil-works/pi-coding-agent';
import { assistantErrorText } from './agent-error-text.js';

function send(msg: unknown): void {
  if (process.send) process.send(msg);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function finalAssistantText(messages: readonly any[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== 'assistant') continue;
    const content = (message.content ?? [])
      .map((part: any) => (part.type === 'text' ? (part.text ?? '') : ''))
      .join('')
      .trim();
    if (content) return content;
  }
  return '';
}

type PiSession = Awaited<ReturnType<typeof createAgentSession>>['session'];

let session: PiSession | null = null;
let sessionKey: string | null = null;

process.on('message', async (msg: any) => {
  if (msg?.type === 'init') {
    try {
      const { sessionKey: key, cwd, sessionDir } = msg as { sessionKey: string; cwd: string; sessionDir: string };
      sessionKey = key;

      await mkdir(sessionDir, { recursive: true });

      const result = await createAgentSession({
        cwd,
        sessionManager: SessionManager.create(cwd, sessionDir),
        sessionStartEvent: { type: 'session_start', reason: 'resume' },
      });

      session = result.session;
      session.setSessionName(sessionKey);

      if (result.modelFallbackMessage) {
        console.warn('[agent-worker] model fallback', { message: result.modelFallbackMessage });
      }

      send({ type: 'ready' });
    } catch (error) {
      send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
      process.exit(1);
    }
    return;
  }

  if (msg?.type === 'prompt') {
    if (!session) {
      send({ type: 'error', message: 'Session not initialized — init message must precede prompt' });
      return;
    }

    const chunks: string[] = [];
    const unsubscribe = session.subscribe((event: unknown) => {
      const e = event as { type?: string; assistantMessageEvent?: { type?: string; delta?: unknown } };
      if (e.type !== 'message_update') return;
      if (e.assistantMessageEvent?.type !== 'text_delta') return;
      const delta = typeof e.assistantMessageEvent.delta === 'string' ? e.assistantMessageEvent.delta : '';
      if (delta) {
        chunks.push(delta);
        send({ type: 'delta', text: delta });
      }
    });

    try {
      promptActive = true;
      await session.prompt(msg.text, { source: 'rpc' });
      const streamed = chunks.join('').trim();
      const errorText = assistantErrorText(session.state.messages);
      const result = errorText || streamed || finalAssistantText(session.state.messages) || '(no response)';
      send({ type: 'done', result });
    } catch (error) {
      send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally {
      promptActive = false;
      unsubscribe();
    }
    return;
  }
});

// Track in-flight prompt state so SIGTERM can abort cleanly.
let promptActive = false;

// Keep the process alive. Without this, Bun would exit after the
// synchronous top-level code finishes and no I/O is pending.
// The IPC channel keeps the event loop alive as long as the parent
// hasn't disconnected, but we set an empty interval as a failsafe.
const keepAlive = setInterval(() => {}, 86_400_000); // no-op every 24h

process.on('SIGTERM', () => {
  clearInterval(keepAlive);
  if (promptActive && session) {
    session.abort().catch((error: unknown) => {
      console.error('[agent-worker] session abort during SIGTERM failed', { error });
    });
  }
  // If no prompt is active, clearing keepAlive lets the process exit naturally.
  // If a prompt is active, the abort will cause session.prompt() to reject,
  // which the catch handler already converts to { type: 'error' } before exiting.
});
