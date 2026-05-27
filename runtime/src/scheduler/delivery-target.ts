import { buildMatrixChatId, decodeMatrixPeerId } from '../channels/matrix/matrix-targets.js';
import { buildTelegramChatJid } from '../channels/telegram/telegram-targets.js';
import { parseSessionKey } from '../routing/session-key.js';

export type OutboundDeliveryTarget = {
  channel: string;
  accountId: string;
  chatId: string;
};

export function resolveOutboundFromSessionKey(sessionKey: string): OutboundDeliveryTarget | null {
  const parsed = parseSessionKey(sessionKey);
  if (!parsed) return null;

  if (parsed.source === 'telegram') {
    const threadId = parsed.threadId ? Number.parseInt(parsed.threadId, 10) : null;
    return {
      channel: 'telegram',
      accountId: parsed.accountId,
      chatId: buildTelegramChatJid(parsed.peerId, threadId != null && Number.isFinite(threadId) ? threadId : null),
    };
  }

  if (parsed.source === 'matrix') {
    const roomId = decodeMatrixPeerId(parsed.peerId);
    return {
      channel: 'matrix',
      accountId: parsed.accountId,
      chatId: buildMatrixChatId(roomId, {
        threadEventId: parsed.threadId ?? null,
        isDirect: parsed.peerKind === 'dm',
      }),
    };
  }

  return null;
}
