import { buildSessionKey, sanitizeSegment } from '../routing/session-key.js';

export function buildSchedulerAgentSessionKey(taskId: string): string {
  const safeTaskId = sanitizeSegment(taskId);
  if (!safeTaskId) throw new Error('invalid scheduler task id for session key');
  return buildSessionKey({
    agentId: 'main',
    source: 'scheduler',
    accountId: 'default',
    peerKind: 'task',
    peerId: safeTaskId,
  });
}
