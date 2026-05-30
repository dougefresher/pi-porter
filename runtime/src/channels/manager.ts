import type { OutboundDelivery } from '../bus/types.js';
import type { ChannelRuntime } from './types.js';

export class ChannelManager {
  private channels = new Map<string, ChannelRuntime>();

  register(channel: ChannelRuntime): void {
    this.channels.set(channel.id, channel);
  }

  async start(): Promise<void> {
    for (const channel of this.channels.values()) {
      await channel.start?.();
    }
  }

  async stop(): Promise<void> {
    for (const channel of [...this.channels.values()].reverse()) {
      await channel.stop?.();
    }
  }

  async send(delivery: OutboundDelivery): Promise<void> {
    const channel = this.channels.get(delivery.channel);
    if (!channel) throw new Error(`No channel registered for ${delivery.channel}`);
    console.log('[channel-manager] send', {
      channel: delivery.channel,
      outboundId: delivery.id,
      chatId: delivery.chatId,
      type: delivery.type,
      contentLength: delivery.content?.length ?? 0,
    });
    await channel.send(delivery);
  }
}
