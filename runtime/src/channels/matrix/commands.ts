import { archiveAndClearPiSession } from '../../agent/archive-pi-session.js';
import { currentSessionFileForKey } from '../../agent/session-paths.js';
import type { PostgresBus } from '../../bus/postgres-bus.js';
import { SessionArchiveStore } from '../../db/session-archive-store.js';
import { parseSessionKey } from '../../routing/session-key.js';
import type { MatrixInboundMessage } from './matrix.js';

export type MatrixCommandContext = {
  bus: PostgresBus;
  sessionArchiveStore: SessionArchiveStore;
  sessionRoot: string;
  sessionKey: string;
  senderId: string;
  chatId: string;
  content: string;
  message: MatrixInboundMessage;
};

function commandName(content: string): string | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith('/')) return null;
  const [raw] = trimmed.split(/\s+/, 1);
  const name = raw?.slice(1).split('@')[0]?.toLowerCase();
  return name || null;
}

export async function handleMatrixCommand(ctx: MatrixCommandContext): Promise<boolean> {
  const name = commandName(ctx.content);
  if (!name) return false;

  const parsed = parseSessionKey(ctx.sessionKey);

  if (name === 'whoami') {
    await ctx.bus.publishOutbound({
      sessionKey: ctx.sessionKey,
      channel: 'matrix',
      accountId: parsed?.accountId ?? 'default',
      chatId: ctx.chatId,
      content: [
        `sender_id: ${ctx.senderId}`,
        `room_id: ${ctx.message.roomId}`,
        `chat_id: ${ctx.chatId}`,
        `session_key: ${ctx.sessionKey}`,
        ctx.message.eventId ? `event_id: ${ctx.message.eventId}` : undefined,
      ]
        .filter(Boolean)
        .join('\n'),
      metadata: { command: name },
    });
    return true;
  }

  if (name === 'clear') {
    const sessionFile = currentSessionFileForKey(ctx.sessionRoot, ctx.sessionKey);

    try {
      const archived = await archiveAndClearPiSession({
        sessionArchiveStore: ctx.sessionArchiveStore,
        sessionRoot: ctx.sessionRoot,
        sessionKey: ctx.sessionKey,
        reason: 'clear',
      });

      await ctx.bus.publishOutbound({
        sessionKey: ctx.sessionKey,
        channel: 'matrix',
        accountId: parsed?.accountId ?? 'default',
        chatId: ctx.chatId,
        content: archived
          ? 'Context cleared. Archived previous Pi session and started fresh.'
          : 'Context cleared. No previous Pi session content was found.',
        metadata: { command: name },
      });
    } catch (error) {
      console.error('[matrix] /clear failed', {
        operation: 'matrix.command.clear.failed',
        sessionKey: ctx.sessionKey,
        sessionFile,
        error,
      });

      await ctx.bus.publishOutbound({
        sessionKey: ctx.sessionKey,
        channel: 'matrix',
        accountId: parsed?.accountId ?? 'default',
        chatId: ctx.chatId,
        content: 'Failed to clear context. Check daemon logs.',
        metadata: { command: name, error: 'clear_failed' },
      });
    }
    return true;
  }

  if (name === 'help') {
    await ctx.bus.publishOutbound({
      sessionKey: ctx.sessionKey,
      channel: 'matrix',
      accountId: parsed?.accountId ?? 'default',
      chatId: ctx.chatId,
      content: [
        'porter: Pi with a phone.',
        '',
        'Commands:',
        '/whoami - show Matrix sender/room/session IDs',
        '/status - show daemon/session status',
        '/clear - archive and reset current Pi context for this room',
        '/help - show this help',
      ].join('\n'),
      metadata: { command: name },
    });
    return true;
  }

  if (name === 'status') {
    await ctx.bus.publishOutbound({
      sessionKey: ctx.sessionKey,
      channel: 'matrix',
      accountId: parsed?.accountId ?? 'default',
      chatId: ctx.chatId,
      content: ['porter online', `session_key: ${ctx.sessionKey}`].join('\n'),
      metadata: { command: name },
    });
    return true;
  }

  return false;
}
