import { archiveAndClearPiSession } from '../../agent/archive-pi-session.js';
import { sessionDirForKey } from '../../agent/session-paths.js';
import type { PostgresBus } from '../../bus/postgres-bus.js';
import { SessionArchiveStore } from '../../db/session-archive-store.js';
import { parseSessionKey } from '../../routing/session-key.js';
import type { TelegramInboundMessage } from './telegram.js';

export type TelegramCommandContext = {
  bus: PostgresBus;
  sessionArchiveStore: SessionArchiveStore;
  sessionRoot: string;
  sessionKey: string;
  senderId: string;
  chatJid: string;
  content: string;
  message: TelegramInboundMessage;
};

function commandName(content: string): string | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith('/')) return null;
  const [raw] = trimmed.split(/\s+/, 1);
  const name = raw?.slice(1).split('@')[0]?.toLowerCase();
  return name || null;
}

export async function handleTelegramCommand(ctx: TelegramCommandContext): Promise<boolean> {
  const name = commandName(ctx.content);
  if (!name) return false;

  if (name === 'whoami') {
    await ctx.bus.publishOutbound({
      sessionKey: ctx.sessionKey,
      channel: 'telegram',
      accountId: parseSessionKey(ctx.sessionKey)?.accountId ?? 'default',
      chatId: ctx.chatJid,
      content: [
        `sender_id: ${ctx.senderId}`,
        `chat_id: ${ctx.chatJid}`,
        `session_key: ${ctx.sessionKey}`,
        ctx.message.senderUsername ? `username: ${ctx.message.senderUsername}` : undefined,
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
        channel: 'telegram',
        accountId: parseSessionKey(ctx.sessionKey)?.accountId ?? 'default',
        chatId: ctx.chatJid,
        content: archived
          ? 'Context cleared. Archived previous Pi session and started fresh.'
          : 'Context cleared. No previous Pi session content was found.',
        metadata: { command: name },
      });
    } catch (error) {
      console.error('[telegram] /clear failed', {
        operation: 'telegram.command.clear.failed',
        sessionKey: ctx.sessionKey,
        sessionDir,
        error,
      });

      await ctx.bus.publishOutbound({
        sessionKey: ctx.sessionKey,
        channel: 'telegram',
        accountId: parseSessionKey(ctx.sessionKey)?.accountId ?? 'default',
        chatId: ctx.chatJid,
        content: 'Failed to clear context. Check daemon logs.',
        metadata: { command: name, error: 'clear_failed' },
      });
    }
    return true;
  }

  if (name === 'help') {
    await ctx.bus.publishOutbound({
      sessionKey: ctx.sessionKey,
      channel: 'telegram',
      accountId: parseSessionKey(ctx.sessionKey)?.accountId ?? 'default',
      chatId: ctx.chatJid,
      content: [
        'porter: Pi with a phone.',
        '',
        'Commands:',
        '/whoami - show Telegram sender/chat/session IDs',
        '/status - show daemon/session status',
        '/clear - archive and reset current Pi context for this chat/topic',
        '/help - show this help',
        '',
        'Non-command messages are sent to pi-coding-agent using the daemon WorkingDirectory as cwd.',
      ].join('\n'),
      metadata: { command: name },
    });
    return true;
  }

  if (name === 'status') {
    await ctx.bus.publishOutbound({
      sessionKey: ctx.sessionKey,
      channel: 'telegram',
      accountId: parseSessionKey(ctx.sessionKey)?.accountId ?? 'default',
      chatId: ctx.chatJid,
      content: ['porter online', `cwd: ${process.cwd()}`, `session_key: ${ctx.sessionKey}`].join('\n'),
      metadata: { command: name },
    });
    return true;
  }

  return false;
}
