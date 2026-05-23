import type { PostgresBus } from '../bus/postgres-bus.js';
import { ChannelManager } from '../channels/manager.js';

export class OutboundWorker {
  private stopped = false;
  private running: Promise<void> | null = null;

  private bus: PostgresBus;
  private channels: ChannelManager;

  constructor(bus: PostgresBus, channels: ChannelManager) {
    this.bus = bus;
    this.channels = channels;
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
        const delivery = await this.bus.claimOutbound();
        if (!delivery) {
          await Bun.sleep(500);
          continue;
        }

        try {
          await this.channels.send(delivery);
          await this.bus.markOutboundSent(delivery.id);
        } catch (error) {
          await this.bus.markOutboundFailed(delivery.id, error);
        }
      } catch (error) {
        console.error('[outbound-worker] loop error', { error });
        await Bun.sleep(1_000);
      }
    }
  }
}
