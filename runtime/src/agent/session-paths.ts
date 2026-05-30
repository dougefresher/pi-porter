import { join } from 'node:path';

export function safeSessionDirName(sessionKey: string): string {
  const normalized = sessionKey.replace(/[^a-zA-Z0-9._-]+/g, '_');
  const base = (normalized || 'session').slice(0, 160);
  const suffix = Bun.hash(sessionKey).toString(16).padStart(12, '0').slice(0, 12);
  return `${base}-${suffix}`;
}

export function sessionDirForKey(sessionRoot: string, sessionKey: string): string {
  return join(sessionRoot, safeSessionDirName(sessionKey));
}

/**
 * Find the most recent Pi session .jsonl file in a session directory.
 *
 * Matches Pi's own continueRecent ordering: most recently modified first.
 * This avoids picking a stale leftover from a crash/restart when multiple
 * .jsonl files happen to exist in the same directory.
 *
 * Returns the absolute path, or null if no .jsonl files exist.
 */
export function findSessionFileInDir(dir: string): string | null {
  try {
    const glob = new Bun.Glob('*.jsonl');
    const candidates: Array<{ path: string; mtime: number }> = [];
    for (const name of glob.scanSync({ cwd: dir, onlyFiles: true })) {
      try {
        candidates.push({ path: join(dir, name), mtime: Bun.file(join(dir, name)).lastModified });
      } catch (error) {
        // ENOENT — race with another process deleting the file. Skip this candidate.
        console.warn('[session-paths] findSessionFileInDir stat failed, skipping', { path: join(dir, name), error });
      }
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.mtime - a.mtime);
    return candidates[0]!.path;
  } catch (error) {
    // Directory doesn't exist yet — expected for sessions that haven't run.
    console.warn('[session-paths] findSessionFileInDir failed', { dir, error });
    return null;
  }
}
