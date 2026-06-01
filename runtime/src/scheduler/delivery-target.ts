import { buildMatrixChatId, decodeMatrixPeerId, decodeMatrixThreadId } from '../channels/matrix/matrix-targets.js';
import { buildTelegramChatJid } from '../channels/telegram/telegram-targets.js';
import { parseSessionKey } from '../routing/session-key.js';

export type OutboundDeliveryTarget = {
  channel: string;
  accountId: string;
  chatId: string;
};

export function resolveOutboundFromSessionKey(sessionKey: string): OutboundDeliveryTarget | null {
  const parsed = parseSessionKey(sessionKey);
  if (!parsed) {
    console.log('[scheduler] resolveOutboundFromSessionKey: null (parse failed)', { sessionKey });
    return null;
  }

  if (parsed.source === 'telegram') {
    const threadId = parsed.threadId ? Number.parseInt(parsed.threadId, 10) : null;
    const result: OutboundDeliveryTarget = {
      channel: 'telegram',
      accountId: parsed.accountId,
      chatId: buildTelegramChatJid(parsed.peerId, threadId != null && Number.isFinite(threadId) ? threadId : null),
    };
    console.log('[scheduler] resolveOutboundFromSessionKey: telegram', { sessionKey, result });
    return result;
  }

  if (parsed.source === 'matrix') {
    const roomId = decodeMatrixPeerId(parsed.peerId);
    const result: OutboundDeliveryTarget = {
      channel: 'matrix',
      accountId: parsed.accountId,
      chatId: buildMatrixChatId(roomId, {
        threadEventId: parsed.threadId ? decodeMatrixThreadId(parsed.threadId) : null,
        isDirect: parsed.peerKind === 'dm',
      }),
    };
    console.log('[scheduler] resolveOutboundFromSessionKey: matrix', { sessionKey, result });
    return result;
  }

  console.log('[scheduler] resolveOutboundFromSessionKey: null (unsupported source)', {
    sessionKey,
    source: parsed.source,
  });
  return null;
}
