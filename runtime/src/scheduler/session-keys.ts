import { buildSessionKey, sanitizeSegment } from '../routing/session-key.js';

export function buildSchedulerAgentSessionKey(taskId: string): string {
  return buildSessionKey({
    agentId: 'main',
    source: 'scheduler',
    accountId: 'default',
    peerKind: 'task',
    peerId: sanitizeSegment(taskId) || taskId,
  });
}
