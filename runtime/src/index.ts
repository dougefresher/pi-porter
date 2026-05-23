#!/usr/bin/env bun

import { loadConfig } from './config.js';
import { SukaDaemon } from './daemon.js';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(
    'suka\n\nUsage:\n  suka            Start the daemon\n  suka --help     Show help\n\nEnvironment:\n  SUKA_DATABASE_URL                    PostgreSQL connection URL\n  SUKA_TELEGRAM_ENABLED=1              Enable Telegram long polling\n  SUKA_TELEGRAM_BOT_TOKEN=<token>      Telegram bot token\n  SUKA_TELEGRAM_ALLOWED_SENDERS=<ids>  Comma-separated numeric sender IDs; * allows all\n  SUKA_AGENT_PROMPT_TIMEOUT_MS=<ms>    Agent prompt timeout; default 900000\n',
  );
  process.exit(0);
}

const daemon = new SukaDaemon(loadConfig());
let stopping = false;

async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`[suka] received ${signal}; shutting down`);
  await daemon.stop();
  process.exit(0);
}

process.on('SIGINT', () => {
  stop('SIGINT').catch((error) => {
    console.error('[suka] shutdown failed', error);
    process.exit(1);
  });
});
process.on('SIGTERM', () => {
  stop('SIGTERM').catch((error) => {
    console.error('[suka] shutdown failed', error);
    process.exit(1);
  });
});

try {
  await daemon.start();
} catch (error) {
  console.error('[suka] fatal startup error', error);
  await daemon.stop().catch(() => {});
  process.exit(1);
}
