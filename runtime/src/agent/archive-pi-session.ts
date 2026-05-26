import { parseSessionEntries } from '@earendil-works/pi-coding-agent';

import type { SessionArchiveStore } from '../db/session-archive-store.js';
import { currentSessionFileForKey } from './session-paths.js';

export async function archiveAndClearPiSession(params: {
  sessionArchiveStore: SessionArchiveStore;
  sessionRoot: string;
  sessionKey: string;
  reason: string;
}): Promise<boolean> {
  const sessionFile = currentSessionFileForKey(params.sessionRoot, params.sessionKey);
  const file = Bun.file(sessionFile);
  if (!(await file.exists())) return false;

  const content = await file.text();
  const trimmed = content.trim();
  if (!trimmed) {
    await file.delete();
    return false;
  }

  const entries = parseSessionEntries(content);
  const header = entries.find((entry) => entry.type === 'session');
  const piSessionId = header && 'id' in header && typeof header.id === 'string' && header.id.trim() ? header.id : null;

  await params.sessionArchiveStore.archive({
    sessionKey: params.sessionKey,
    reason: params.reason,
    piSessionId,
    lineCount: content.split('\n').filter((line) => line.trim().length > 0).length,
    content,
  });
  await file.delete();
  return true;
}
