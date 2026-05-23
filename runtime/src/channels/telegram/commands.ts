import type { PostgresBus } from '../../bus/postgres-bus.js';
import { parseSessionKey } from '../../routing/session-key.js';
import type { TelegramInboundMessage } from './telegram.js';

export type TelegramCommandContext = {
  bus: PostgresBus;
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

  if (name === 'help') {
    await ctx.bus.publishOutbound({
      sessionKey: ctx.sessionKey,
      channel: 'telegram',
      accountId: parseSessionKey(ctx.sessionKey)?.accountId ?? 'default',
      chatId: ctx.chatJid,
      content: [
        'suka: Pi with a phone.',
        '',
        'Commands:',
        '/whoami - show Telegram sender/chat/session IDs',
        '/status - show daemon/session status',
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
      content: ['suka online', `cwd: ${process.cwd()}`, `session_key: ${ctx.sessionKey}`].join('\n'),
      metadata: { command: name },
    });
    return true;
  }

  return false;
}
