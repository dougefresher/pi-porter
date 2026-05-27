import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return path;
}

function readEnv(name: string, fallback = ''): string {
  return process.env[name]?.trim() || fallback;
}

function readCsvEnv(name: string): string[] {
  return readEnv(name)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export type PorterConfig = {
  stateDir: string;
  configDir: string;
  agentPromptTimeoutMs: number;
  telegram: {
    enabled: boolean;
    botToken: string;
    pollingTimeoutSeconds: number;
    allowedSenders: string[];
  };
  matrix: {
    enabled: boolean;
    homeserverUrl: string;
    accessToken: string;
    userId: string;
    allowedSenders: string[];
    allowedRooms: string[];
    autoJoinInvites: boolean;
  };
};

export function loadConfig(): PorterConfig {
  const stateDir = expandHome(readEnv('PORTER_STATE_DIR', '~/.local/state/porter'));
  const configDir = expandHome(readEnv('PORTER_CONFIG_DIR', '~/.config/porter'));
  const telegramEnabled = ['1', 'true', 'yes', 'on'].includes(readEnv('PORTER_TELEGRAM_ENABLED', '0').toLowerCase());
  const botToken = readEnv('PORTER_TELEGRAM_BOT_TOKEN', readEnv('TELEGRAM_BOT_TOKEN'));
  const allowedSenders = readCsvEnv('PORTER_TELEGRAM_ALLOWED_SENDERS');
  const matrixEnabled = ['1', 'true', 'yes', 'on'].includes(readEnv('PORTER_MATRIX_ENABLED', '0').toLowerCase());
  const matrixHomeserverUrl = readEnv('PORTER_MATRIX_HOMESERVER_URL', readEnv('MATRIX_HOMESERVER_URL'));
  const matrixAccessToken = readEnv('PORTER_MATRIX_ACCESS_TOKEN', readEnv('MATRIX_ACCESS_TOKEN'));
  const matrixUserId = readEnv('PORTER_MATRIX_USER_ID', readEnv('MATRIX_USER_ID'));
  const matrixAllowedSenders = readCsvEnv('PORTER_MATRIX_ALLOWED_SENDERS');
  const matrixAllowedRooms = readCsvEnv('PORTER_MATRIX_ALLOWED_ROOMS');
  const matrixAutoJoinInvites = ['1', 'true', 'yes', 'on'].includes(
    readEnv('PORTER_MATRIX_AUTO_JOIN_INVITES', '1').toLowerCase(),
  );

  if (telegramEnabled && !botToken) throw new Error('Missing Telegram bot token: PORTER_TELEGRAM_BOT_TOKEN');
  if (telegramEnabled && allowedSenders.length === 0) {
    throw new Error('PORTER_TELEGRAM_ALLOWED_SENDERS must be non-empty when Telegram is enabled');
  }
  if (matrixEnabled && !matrixHomeserverUrl) {
    throw new Error('Missing Matrix homeserver URL: PORTER_MATRIX_HOMESERVER_URL');
  }
  if (matrixEnabled && !matrixAccessToken) {
    throw new Error('Missing Matrix access token: PORTER_MATRIX_ACCESS_TOKEN');
  }
  if (matrixEnabled && matrixAllowedSenders.length === 0) {
    throw new Error('PORTER_MATRIX_ALLOWED_SENDERS must be non-empty when Matrix is enabled');
  }

  return {
    stateDir,
    configDir,
    agentPromptTimeoutMs: Number.parseInt(readEnv('PORTER_AGENT_PROMPT_TIMEOUT_MS', '900000'), 10) || 900_000,
    telegram: {
      enabled: telegramEnabled,
      botToken,
      pollingTimeoutSeconds: Number.parseInt(readEnv('PORTER_TELEGRAM_POLL_TIMEOUT_SECONDS', '30'), 10) || 30,
      allowedSenders,
    },
    matrix: {
      enabled: matrixEnabled,
      homeserverUrl: matrixHomeserverUrl,
      accessToken: matrixAccessToken,
      userId: matrixUserId,
      allowedSenders: matrixAllowedSenders,
      allowedRooms: matrixAllowedRooms,
      autoJoinInvites: matrixAutoJoinInvites,
    },
  };
}

export async function ensureRuntimeDirs(config: PorterConfig): Promise<void> {
  await mkdir(config.stateDir, { recursive: true });
  await mkdir(config.configDir, { recursive: true });
  await mkdir(`${config.stateDir}/cron`, { recursive: true });
}
