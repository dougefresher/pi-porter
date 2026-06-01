import { buildSessionKey } from '../../routing/session-key.js';
import { encodeMatrixPeerId, encodeMatrixThreadId, parseMatrixTarget } from './matrix-targets.js';

// Session key shape and thread ID encoding: ./docs/matrix.md#how-session-keys-work

export function buildMatrixSessionKey(chatId: string, options?: { isDirect?: boolean }): string {
  const target = parseMatrixTarget(chatId);
  return buildSessionKey({
    agentId: 'main',
    source: 'matrix',
    accountId: 'default',
    peerKind: options?.isDirect ? 'dm' : 'room',
    peerId: encodeMatrixPeerId(target.roomId),
    threadId: target.threadEventId ? encodeMatrixThreadId(target.threadEventId) : null,
  });
}
