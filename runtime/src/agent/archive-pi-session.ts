import { parseSessionEntries } from '@earendil-works/pi-coding-agent';

import type { SessionArchiveStore } from '../db/session-archive-store.js';
import { findSessionFileInDir, sessionDirForKey } from './session-paths.js';

async function deleteSessionFile(
  file: ReturnType<typeof Bun.file>,
  context: { sessionKey: string; sessionFile: string; reason: string },
): Promise<void> {
  try {
    await file.delete();
  } catch (error) {
    console.error('[archive] failed to delete session file', { ...context, error });
    throw error;
  }
}

export async function archiveAndClearPiSession(params: {
  sessionArchiveStore: SessionArchiveStore;
  sessionRoot: string;
  sessionKey: string;
  reason: string;
}): Promise<boolean> {
  const sessionDir = sessionDirForKey(params.sessionRoot, params.sessionKey);
  const sessionFile = findSessionFileInDir(sessionDir);
  if (!sessionFile) return false;

  const file = Bun.file(sessionFile);
  const content = await file.text();
  const trimmed = content.trim();
  if (!trimmed) {
    await deleteSessionFile(file, {
      sessionKey: params.sessionKey,
      sessionFile,
      reason: params.reason,
    });
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
  await deleteSessionFile(file, {
    sessionKey: params.sessionKey,
    sessionFile,
    reason: params.reason,
  });
  return true;
}
