import type { OutboundDelivery } from '../bus/types.js';

export type ChannelKind = 'web' | 'telegram' | 'matrix' | 'scheduler' | 'cli';

export interface ChannelRuntime {
  id: ChannelKind;
  start?(): Promise<void>;
  stop?(): Promise<void>;
  send(delivery: OutboundDelivery): Promise<void>;
}
