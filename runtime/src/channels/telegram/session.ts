import { buildSessionKey } from '../../routing/session-key.js';
import { parseTelegramTarget } from './telegram-targets.js';

export function buildTelegramSessionKey(chatJid: string): string {
  const target = parseTelegramTarget(chatJid);
  return buildSessionKey({
    agentId: 'main',
    source: 'telegram',
    accountId: 'default',
    peerKind: target.chatType === 'direct' ? 'dm' : target.chatType,
    peerId: target.chatId,
    threadId: target.messageThreadId == null ? null : String(target.messageThreadId),
  });
}
