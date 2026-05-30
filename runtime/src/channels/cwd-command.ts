import { statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { PostgresBus } from '../bus/postgres-bus.js';
import type { ChannelWorkdirStore } from '../db/channel-workdir-store.js';
import { parseSessionKey } from '../routing/session-key.js';

export type CwdCommandParams = {
  bus: PostgresBus;
  workdirStore: ChannelWorkdirStore | undefined;
  sessionKey: string;
  channel: string;
  chatId: string;
  content: string;
  roomId: string;
};

export async function handleCwdCommand(params: CwdCommandParams): Promise<void> {
  const { bus, workdirStore, sessionKey, channel, chatId, content, roomId } = params;
  const accountId = parseSessionKey(sessionKey)?.accountId ?? 'default';
  const daemonCwd = process.cwd();

  async function reply(text: string, metadata?: Record<string, unknown>): Promise<void> {
    await bus.publishOutbound({
      sessionKey,
      channel,
      accountId,
      chatId,
      content: text,
      metadata: { command: 'cwd', ...metadata },
    });
  }

  if (!workdirStore) {
    await reply('/cwd is not available.');
    return;
  }

  const args = content.trim().split(/\s+/).slice(1);
  const arg = args.join(' ').trim();

  if (!arg) {
    // show current
    const stored = await workdirStore.get(roomId);
    const current = stored ?? daemonCwd;
    const source = stored ? 'set' : 'default';
    await reply(`Working directory (${source}): ${current}`);
    return;
  }

  if (arg === '--reset') {
    await workdirStore.delete(roomId);
    await reply(`Working directory reset to default: ${daemonCwd}`);
    return;
  }

  // resolve path
  const resolvedPath = isAbsolute(arg) ? arg : resolve(daemonCwd, arg);

  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(resolvedPath);
  } catch {
    await reply(`Error: path does not exist: ${resolvedPath}`);
    return;
  }

  if (!stat.isDirectory()) {
    await reply(`Error: not a directory: ${resolvedPath}`);
    return;
  }

  await workdirStore.set(roomId, resolvedPath);
  await reply(`Working directory set to: ${resolvedPath}`);
}
