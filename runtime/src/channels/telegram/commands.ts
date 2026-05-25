import { parseSessionEntries } from '@earendil-works/pi-coding-agent';
import { currentSessionFileForKey } from '../../agent/session-paths.js';
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
    const sessionFile = currentSessionFileForKey(ctx.sessionRoot, ctx.sessionKey);

    try {
      let archived = false;
      const file = Bun.file(sessionFile);
      if (await file.exists()) {
        const content = await file.text();
        const trimmed = content.trim();
        if (trimmed) {
          const entries = parseSessionEntries(content);
          const header = entries.find((entry) => entry.type === 'session');
          const piSessionId =
            header && 'id' in header && typeof header.id === 'string' && header.id.trim() ? header.id : null;

          await ctx.sessionArchiveStore.archive({
            sessionKey: ctx.sessionKey,
            reason: 'clear',
            piSessionId,
            lineCount: content.split('\n').filter((line) => line.trim().length > 0).length,
            content,
          });
          archived = true;
        }
        await Bun.file(sessionFile).delete();
      }

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
        sessionFile,
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
