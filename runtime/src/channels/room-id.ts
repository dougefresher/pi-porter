import type { InboundEvent } from '../bus/types.js';

/**
 * Derives a stable room identifier from channel-specific data.
 *
 * - Telegram: the base chat ID with `telegram:` prefix stripped
 *   (e.g. "telegram:-1003801158703" → "-1003801158703")
 * - Matrix: the bare room ID from metadata.roomId
 *   (e.g. "!wzxHFYaZwEjmpVibbK:dougefresh.dev")
 *
 * These two namespaces can't collide — Telegram chat IDs are numeric/signed,
 * Matrix room IDs are `!localpart:domain`.
 */
export function roomIdForInbound(event: InboundEvent): string {
  if (event.channel === 'matrix') {
    const roomId = typeof event.metadata.roomId === 'string' ? event.metadata.roomId : '';
    return roomId || event.chatId;
  }
  if (event.channel === 'telegram') {
    return telegramRoomId(event.chatId);
  }
  return event.chatId;
}

/**
 * Strip internal prefixes from a Telegram chat JID.
 *
 * "telegram:-1003801158703" → "-1003801158703"
 */
export function telegramRoomId(chatJid: string): string {
  return chatJid.replace(/^(?:telegram|tg):/i, '');
}
