#!/usr/bin/env bun

import { loadConfig } from './config.js';
import { PorterDaemon } from './daemon.js';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(
    'porter\n\nUsage:\n  porter            Start the daemon\n  porter --help     Show help\n\nEnvironment:\n  DATABASE_URL                           PostgreSQL connection URL\n  PORTER_TELEGRAM_ENABLED=1              Enable Telegram long polling\n  PORTER_TELEGRAM_BOT_TOKEN=<token>      Telegram bot token\n  PORTER_TELEGRAM_ALLOWED_SENDERS=<ids>  Comma-separated numeric sender IDs; * allows all\n  PORTER_AGENT_PROMPT_TIMEOUT_MS=<ms>    Agent prompt timeout; default 900000\n',
  );
  process.exit(0);
}

const daemon = new PorterDaemon(loadConfig());
let stopping = false;

async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`[porter] received ${signal}; shutting down`);
  await daemon.stop();
  process.exit(0);
}

process.on('SIGINT', () => {
  stop('SIGINT').catch((error) => {
    console.error('[porter] shutdown failed', error);
    process.exit(1);
  });
});
process.on('SIGTERM', () => {
  stop('SIGTERM').catch((error) => {
    console.error('[porter] shutdown failed', error);
    process.exit(1);
  });
});

try {
  await daemon.start();
} catch (error) {
  console.error('[porter] fatal startup error', error);
  await daemon.stop().catch((error) => {
    console.warn('[porter] cleanup after startup failure failed', { err: error });
  });
  process.exit(1);
}
