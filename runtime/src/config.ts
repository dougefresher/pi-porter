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

export type SukaConfig = {
  stateDir: string;
  configDir: string;
  agentPromptTimeoutMs: number;
  telegram: {
    enabled: boolean;
    botToken: string;
    pollingTimeoutSeconds: number;
    allowedSenders: string[];
  };
};

export function loadConfig(): SukaConfig {
  const stateDir = expandHome(readEnv('SUKA_STATE_DIR', '~/.local/state/suka'));
  const configDir = expandHome(readEnv('SUKA_CONFIG_DIR', '~/.config/suka'));
  const telegramEnabled = ['1', 'true', 'yes', 'on'].includes(readEnv('SUKA_TELEGRAM_ENABLED', '0').toLowerCase());
  const botToken = readEnv('SUKA_TELEGRAM_BOT_TOKEN', readEnv('TELEGRAM_BOT_TOKEN'));
  const allowedSenders = readCsvEnv('SUKA_TELEGRAM_ALLOWED_SENDERS');

  if (telegramEnabled && !botToken) throw new Error('Missing Telegram bot token: SUKA_TELEGRAM_BOT_TOKEN');
  if (telegramEnabled && allowedSenders.length === 0) {
    throw new Error('SUKA_TELEGRAM_ALLOWED_SENDERS must be non-empty when Telegram is enabled');
  }

  return {
    stateDir,
    configDir,
    agentPromptTimeoutMs: Number.parseInt(readEnv('SUKA_AGENT_PROMPT_TIMEOUT_MS', '900000'), 10) || 900_000,
    telegram: {
      enabled: telegramEnabled,
      botToken,
      pollingTimeoutSeconds: Number.parseInt(readEnv('SUKA_TELEGRAM_POLL_TIMEOUT_SECONDS', '30'), 10) || 30,
      allowedSenders,
    },
  };
}

export async function ensureRuntimeDirs(config: SukaConfig): Promise<void> {
  await mkdir(config.stateDir, { recursive: true });
  await mkdir(config.configDir, { recursive: true });
}
