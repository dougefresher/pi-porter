import { PiAgentRunner } from './agent/pi-runner.js';
import { PostgresBus } from './bus/postgres-bus.js';
import { ChannelManager } from './channels/manager.js';
import { TelegramRuntime } from './channels/telegram/index.js';
import { ensureRuntimeDirs, type PorterConfig } from './config.js';
import { closeDb, type Db, getDb } from './db/client.js';
import { migrate } from './db/migrate.js';
import { ScheduledTaskStore } from './db/scheduled-task-store.js';
import { SessionArchiveStore } from './db/session-archive-store.js';
import { SessionStore } from './db/session-store.js';
import { TranscriptStore } from './db/transcript-store.js';
import { SchedulerRegistry } from './scheduler/registry.js';
import { InboundWorker } from './workers/inbound-worker.js';
import { OutboundWorker } from './workers/outbound-worker.js';

export class PorterDaemon {
  private channels: ChannelManager | null = null;
  private config: PorterConfig;
  private db: Db | null = null;
  private inboundWorker: InboundWorker | null = null;
  private outboundWorker: OutboundWorker | null = null;
  private scheduler: SchedulerRegistry | null = null;

  constructor(config: PorterConfig) {
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
    const scheduledTasks = new ScheduledTaskStore(db);
    const channels = new ChannelManager();
    this.channels = channels;

    const sessionRoot = `${this.config.stateDir}/pi-sessions`;

    if (this.config.telegram.enabled) {
      if (!this.config.telegram.botToken)
        throw new Error('PORTER_TELEGRAM_BOT_TOKEN is required when Telegram is enabled.');
      channels.register(
        new TelegramRuntime({
          bus,
          sessionStore: sessions,
          sessionArchiveStore: sessionArchives,
          sessionRoot,
          botToken: this.config.telegram.botToken,
          pollingTimeoutSeconds: this.config.telegram.pollingTimeoutSeconds,
          allowedSenders: this.config.telegram.allowedSenders,
        }),
      );
    }

    const scheduler = new SchedulerRegistry({
      bus,
      sessions,
      store: scheduledTasks,
    });
    this.scheduler = scheduler;

    this.inboundWorker = new InboundWorker(bus, sessions, transcripts, new PiAgentRunner(this.config), {
      stateDir: this.config.stateDir,
      sessionRoot,
      sessionArchiveStore: sessionArchives,
      scheduledTasks,
      scheduler,
    });
    this.outboundWorker = new OutboundWorker(bus, channels);

    try {
      await channels.start();
      this.outboundWorker.start();
      this.inboundWorker.start();
      await scheduler.start();
    } catch (error) {
      await this.stop();
      throw error;
    }

    console.log('[porter] daemon started');
  }

  async stop(): Promise<void> {
    this.scheduler?.stop();
    this.scheduler = null;

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
    console.log('[porter] daemon stopped');
  }
}
