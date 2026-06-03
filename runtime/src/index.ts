#!/usr/bin/env bun

import { parseArgs } from 'node:util';
import { runCli } from './cli.js';
import { loadConfig } from './config.js';
import { PorterDaemon } from './daemon.js';

const { values } = parseArgs({
  args: Bun.argv,
  options: {
    help: { type: 'boolean', short: 'h' },
    serve: { type: 'boolean' },
    'agent-worker': { type: 'boolean' },
  },
  strict: true,
  allowPositionals: true,
});

if (values.help) {
  console.log(
    'porter\n\n' +
      'Usage:\n' +
      '  porter               Client CLI (default)\n' +
      '  porter --serve        Start the daemon\n' +
      '  porter --help         Show help\n\n' +
      'Internal (spawned by daemon):\n' +
      '  porter --agent-worker  Run as a long-lived agent worker process\n\n' +
      'Environment:\n' +
      '  DATABASE_URL                           PostgreSQL connection URL\n' +
      '  PORTER_TELEGRAM_ENABLED=1              Enable Telegram long polling\n' +
      '  PORTER_TELEGRAM_BOT_TOKEN=<token>      Telegram bot token\n' +
      '  PORTER_TELEGRAM_ALLOWED_SENDERS=<ids>  Comma-separated numeric sender IDs; * allows all\n' +
      '  PORTER_AGENT_PROMPT_TIMEOUT_MS=<ms>    Agent prompt timeout; default 900000\n' +
      '  PORTER_AGENT_WORKER_MAX_COUNT=<n>      Max agent worker processes; default 10\n' +
      '  PORTER_AGENT_WORKER_IDLE_TIMEOUT_MS=<ms>  Idle worker eviction; default 600000\n',
  );
  process.exit(0);
}

// --agent-worker: child-process mode, runs a single long-lived Pi session.
if (values['agent-worker']) {
  await import('./agent/agent-worker.js');
  // agent-worker.ts registers IPC handlers and a keep-alive interval.
  // The process stays alive until the parent disconnects or sends SIGTERM.
} else if (values.serve) {
  // --serve: daemon mode.
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
} else {
  // Default: client CLI mode. Talks to the daemon over a UNIX socket.
  await runCli(Bun.argv);
}
