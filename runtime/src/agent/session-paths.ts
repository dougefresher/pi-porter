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

export function currentSessionFileForKey(sessionRoot: string, sessionKey: string): string {
  return join(sessionDirForKey(sessionRoot, sessionKey), 'current.jsonl');
}
