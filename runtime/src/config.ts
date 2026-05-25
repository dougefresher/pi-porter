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
};

export function loadConfig(): PorterConfig {
  const stateDir = expandHome(readEnv('PORTER_STATE_DIR', '~/.local/state/porter'));
  const configDir = expandHome(readEnv('PORTER_CONFIG_DIR', '~/.config/porter'));
  const telegramEnabled = ['1', 'true', 'yes', 'on'].includes(readEnv('PORTER_TELEGRAM_ENABLED', '0').toLowerCase());
  const botToken = readEnv('PORTER_TELEGRAM_BOT_TOKEN', readEnv('TELEGRAM_BOT_TOKEN'));
  const allowedSenders = readCsvEnv('PORTER_TELEGRAM_ALLOWED_SENDERS');

  if (telegramEnabled && !botToken) throw new Error('Missing Telegram bot token: PORTER_TELEGRAM_BOT_TOKEN');
  if (telegramEnabled && allowedSenders.length === 0) {
    throw new Error('PORTER_TELEGRAM_ALLOWED_SENDERS must be non-empty when Telegram is enabled');
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
  };
}

export async function ensureRuntimeDirs(config: PorterConfig): Promise<void> {
  await mkdir(config.stateDir, { recursive: true });
  await mkdir(config.configDir, { recursive: true });
}
