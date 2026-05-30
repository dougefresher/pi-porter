import { archiveAndClearPiSession } from '../../agent/archive-pi-session.js';
import { sessionDirForKey } from '../../agent/session-paths.js';
import type { PostgresBus } from '../../bus/postgres-bus.js';
import type { ChannelWorkdirStore } from '../../db/channel-workdir-store.js';
import { SessionArchiveStore } from '../../db/session-archive-store.js';
import { parseSessionKey } from '../../routing/session-key.js';
import { handleCwdCommand } from '../cwd-command.js';
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
  workdirStore?: ChannelWorkdirStore;
};

function commandName(content: string): string | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith('/')) return null;
  const [raw] = trimmed.split(/\s+/, 1);
  const name = raw?.slice(1).split('@')[0]?.toLowerCase();
  return name || null;
}

export function isMatrixSlashCommand(content: string): boolean {
  return commandName(content) !== null;
}

export async function handleMatrixCommand(ctx: MatrixCommandContext): Promise<boolean> {
  const name = commandName(ctx.content);
  if (!name) return false;

  console.log('[matrix] command', {
    command: name,
    sessionKey: ctx.sessionKey,
    chatId: ctx.chatId,
    senderId: ctx.senderId,
  });

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
    const sessionDir = sessionDirForKey(ctx.sessionRoot, ctx.sessionKey);

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
        sessionDir,
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
        '/cwd - show or set the agent working directory for this room',
        '/help - show this help',
      ].join('\n'),
      metadata: { command: name },
    });
    return true;
  }

  if (name === 'cwd') {
    await handleCwdCommand({
      bus: ctx.bus,
      workdirStore: ctx.workdirStore,
      sessionKey: ctx.sessionKey,
      channel: 'matrix',
      chatId: ctx.chatId,
      content: ctx.content,
      roomId: ctx.message.roomId,
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
