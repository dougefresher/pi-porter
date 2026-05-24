import { PiAgentRunner } from './agent/pi-runner.js';
import { PostgresBus } from './bus/postgres-bus.js';
import { ChannelManager } from './channels/manager.js';
import { TelegramRuntime } from './channels/telegram/index.js';
import { ensureRuntimeDirs, type SukaConfig } from './config.js';
import { closeDb, type Db, getDb } from './db/client.js';
import { migrate } from './db/migrate.js';
import { SessionArchiveStore } from './db/session-archive-store.js';
import { SessionStore } from './db/session-store.js';
import { TranscriptStore } from './db/transcript-store.js';
import { InboundWorker } from './workers/inbound-worker.js';
import { OutboundWorker } from './workers/outbound-worker.js';

export class SukaDaemon {
  private channels: ChannelManager | null = null;
  private config: SukaConfig;
  private db: Db | null = null;
  private inboundWorker: InboundWorker | null = null;
  private outboundWorker: OutboundWorker | null = null;

  constructor(config: SukaConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    await ensureRuntimeDirs(this.config);

    const db = getDb();
    this.db = db;
    await migrate(db);

    const bus = new PostgresBus(db);
    const sessions = new SessionStore(db);
    const sessionArchives = new SessionArchiveStore(db);
    const transcripts = new TranscriptStore(db);
    const channels = new ChannelManager();
    this.channels = channels;

    if (this.config.telegram.enabled) {
      if (!this.config.telegram.botToken)
        throw new Error('SUKA_TELEGRAM_BOT_TOKEN is required when Telegram is enabled.');
      channels.register(
        new TelegramRuntime({
          bus,
          sessionStore: sessions,
          sessionArchiveStore: sessionArchives,
          sessionRoot: `${this.config.stateDir}/pi-sessions`,
          botToken: this.config.telegram.botToken,
          pollingTimeoutSeconds: this.config.telegram.pollingTimeoutSeconds,
          allowedSenders: this.config.telegram.allowedSenders,
        }),
      );
    }

    this.inboundWorker = new InboundWorker(bus, sessions, transcripts, new PiAgentRunner(this.config));
    this.outboundWorker = new OutboundWorker(bus, channels);

    await channels.start();
    this.outboundWorker.start();
    this.inboundWorker.start();

    console.log('[suka] daemon started');
  }

  async stop(): Promise<void> {
    await this.inboundWorker?.stop();
    this.inboundWorker = null;

    await this.outboundWorker?.stop();
    this.outboundWorker = null;

    await this.channels?.stop();
    this.channels = null;

    if (this.db) {
      await closeDb(this.db);
      this.db = null;
    }
    console.log('[suka] daemon stopped');
  }
}
