import { readdirSync } from 'node:fs';
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

/** Find the Pi session .jsonl file in a session directory, or null if none exists. */
export function findSessionFileInDir(dir: string): string | null {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        return join(dir, entry.name);
      }
    }
  } catch (error) {
    // Directory doesn't exist yet — expected for sessions that haven't run.
    console.warn('[session-paths] findSessionFileInDir readdir failed', { dir, error });
  }
  return null;
}
