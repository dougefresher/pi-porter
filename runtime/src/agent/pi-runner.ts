import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createAgentSession, SessionManager } from '@earendil-works/pi-coding-agent';
import type { PorterConfig } from '../config.js';
import { assistantErrorText } from './agent-error-text.js';
import type { AgentRunInput, AgentRunner } from './runner.js';
import { sessionDirForKey } from './session-paths.js';

function collectTextDelta(event: unknown): string {
  const e = event as { type?: string; assistantMessageEvent?: { type?: string; delta?: unknown } };
  if (e.type !== 'message_update') return '';
  if (e.assistantMessageEvent?.type !== 'text_delta') return '';
  return typeof e.assistantMessageEvent.delta === 'string' ? e.assistantMessageEvent.delta : '';
}

function finalAssistantText(session: Awaited<ReturnType<typeof createAgentSession>>['session']): string {
  for (let i = session.state.messages.length - 1; i >= 0; i -= 1) {
    const message = session.state.messages[i];
    if (message?.role !== 'assistant') continue;
    const content = message.content
      .map((part) => (part.type === 'text' ? part.text : ''))
      .join('')
      .trim();
    if (content) return content;
  }
  return '';
}

export class PiAgentRunner implements AgentRunner {
  private cwd: string;
  private promptTimeoutMs: number;
  private sessionRoot: string;

  constructor(config: PorterConfig) {
    this.cwd = process.cwd();
    this.promptTimeoutMs = config.agentPromptTimeoutMs;
    this.sessionRoot = join(config.stateDir, 'pi-sessions');
  }

  async run(input: AgentRunInput): Promise<string> {
    const sessionDir = sessionDirForKey(this.sessionRoot, input.sessionKey);
    await mkdir(sessionDir, { recursive: true });

    const cwd = input.cwd ?? this.cwd;
    const { session, modelFallbackMessage } = await createAgentSession({
      cwd,
      sessionManager: SessionManager.create(cwd, sessionDir),
      sessionStartEvent: {
        type: 'session_start',
        reason: 'resume',
      },
    });

    // Set display name so session listings, archiving, and debugging use the porter identity.
    session.setSessionName(input.sessionKey);

    const chunks: string[] = [];
    const unsubscribe = session.subscribe((event) => {
      const delta = collectTextDelta(event);
      if (delta) chunks.push(delta);
    });

    try {
      if (modelFallbackMessage) console.warn('[agent] model fallback', { message: modelFallbackMessage });
      const timeout = setTimeout(() => {
        session.abort().catch((error) => {
          console.error('[agent] prompt abort failed', { error });
        });
      }, this.promptTimeoutMs);
      try {
        await session.prompt(input.text, { source: 'rpc' });
      } finally {
        clearTimeout(timeout);
      }
      const streamed = chunks.join('').trim();
      const errorText = assistantErrorText(session.state.messages);
      if (errorText) return errorText;
      return streamed || finalAssistantText(session) || '(no response)';
    } finally {
      unsubscribe();
      session.dispose();
    }
  }
}
