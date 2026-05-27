import { buildSessionKey } from '../../routing/session-key.js';
import { encodeMatrixPeerId, parseMatrixTarget } from './matrix-targets.js';

export function buildMatrixSessionKey(chatId: string, options?: { isDirect?: boolean }): string {
  const target = parseMatrixTarget(chatId);
  return buildSessionKey({
    agentId: 'main',
    source: 'matrix',
    accountId: 'default',
    peerKind: options?.isDirect ? 'dm' : 'room',
    peerId: encodeMatrixPeerId(target.roomId),
    threadId: target.threadEventId ?? null,
  });
}
