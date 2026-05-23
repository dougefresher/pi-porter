import type { AgentRunner } from '../agent/runner.js';
import type { PostgresBus } from '../bus/postgres-bus.js';
import type { InboundEvent } from '../bus/types.js';
import { SessionStore } from '../db/session-store.js';
import { TranscriptStore } from '../db/transcript-store.js';

export class InboundWorker {
  private stopped = false;
  private running: Promise<void> | null = null;
  private sessionLocks = new Set<string>();

  private agent: AgentRunner;
  private bus: PostgresBus;
  private sessions: SessionStore;
  private transcripts: TranscriptStore;

  constructor(bus: PostgresBus, sessions: SessionStore, transcripts: TranscriptStore, agent: AgentRunner) {
    this.bus = bus;
    this.sessions = sessions;
    this.transcripts = transcripts;
    this.agent = agent;
  }

  start(): void {
    if (this.running && !this.stopped) return;
    this.stopped = false;
    this.running = this.loop().finally(() => {
      this.running = null;
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.running;
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      try {
        const event = await this.bus.claimInbound();
        if (!event) {
          await Bun.sleep(500);
          continue;
        }
        await this.process(event);
      } catch (error) {
        console.error('[inbound-worker] loop error', { error });
        await Bun.sleep(1_000);
      }
    }
  }

  private async process(event: InboundEvent): Promise<void> {
    while (!this.stopped && this.sessionLocks.has(event.sessionKey)) {
      await Bun.sleep(50);
    }
    if (this.stopped) return;

    this.sessionLocks.add(event.sessionKey);
    try {
      await this.transcripts.append({
        sessionKey: event.sessionKey,
        inboundId: event.id,
        role: 'user',
        content: event.content,
        payload: { metadata: event.metadata },
      });

      const reply = await this.agent.run({
        sessionKey: event.sessionKey,
        inboundId: event.id,
        text: event.content,
        metadata: event.metadata,
      });
      await this.transcripts.append({
        sessionKey: event.sessionKey,
        inboundId: event.id,
        role: 'assistant',
        content: reply,
      });

      await this.bus.publishOutbound({
        inboundId: event.id,
        sessionKey: event.sessionKey,
        channel: event.channel,
        accountId: event.accountId,
        chatId: event.chatId,
        content: reply,
        metadata: { inboundId: event.id },
      });
      await this.sessions.bumpMessageCount(event.sessionKey, 2);
      await this.bus.markInboundDone(event.id);
    } catch (error) {
      await this.bus.markInboundFailed(event.id, error);
    } finally {
      this.sessionLocks.delete(event.sessionKey);
    }
  }
}
