import type { PostgresBus } from '../../bus/postgres-bus.js';
import type { OutboundDelivery } from '../../bus/types.js';
import { SessionArchiveStore } from '../../db/session-archive-store.js';
import { SessionStore } from '../../db/session-store.js';
import { parseSessionKey } from '../../routing/session-key.js';
import type { ChannelRuntime } from '../types.js';
import { TelegramAccessControl } from './access.js';
import { handleTelegramCommand } from './commands.js';
import { buildTelegramSessionKey } from './session.js';
import { TelegramChannel } from './telegram.js';

export type TelegramRuntimeOptions = {
  bus: PostgresBus;
  sessionStore: SessionStore;
  sessionArchiveStore: SessionArchiveStore;
  sessionRoot: string;
  botToken: string;
  pollingTimeoutSeconds: number;
  allowedSenders: string[];
};

export class TelegramRuntime implements ChannelRuntime {
  readonly id = 'telegram' as const;
  private access: TelegramAccessControl;
  private bus: PostgresBus;
  private sessionStore: SessionStore;
  private sessionArchiveStore: SessionArchiveStore;
  private sessionRoot: string;
  private channel: TelegramChannel;

  constructor(options: TelegramRuntimeOptions) {
    this.access = new TelegramAccessControl(options.allowedSenders);
    this.bus = options.bus;
    this.sessionStore = options.sessionStore;
    this.sessionArchiveStore = options.sessionArchiveStore;
    this.sessionRoot = options.sessionRoot;
    this.channel = new TelegramChannel({
      botToken: options.botToken,
      pollingTimeoutSeconds: options.pollingTimeoutSeconds,
      assistantName: 'suka',
      onMessage: async (message) => {
        if (message.isFromMe) return;

        const access = this.access.check(message.senderId ?? '');
        if (!access.allowed) {
          console.warn('[telegram] rejected inbound message', {
            operation: 'telegram.access_denied',
            reason: access.reason,
            senderId: message.senderId ?? null,
            senderUsername: message.senderUsername ?? null,
            chatJid: message.chatJid,
          });
          return;
        }

        const sessionKey = buildTelegramSessionKey(message.chatJid);
        const parsed = parseSessionKey(sessionKey);
        if (!parsed) throw new Error(`failed to parse generated Telegram session key: ${sessionKey}`);

        await this.sessionStore.ensureSession(sessionKey, parsed);

        const handled = await handleTelegramCommand({
          bus: this.bus,
          sessionArchiveStore: this.sessionArchiveStore,
          sessionRoot: this.sessionRoot,
          sessionKey,
          senderId: message.senderId ?? parsed.peerId,
          chatJid: message.chatJid,
          content: message.content,
          message,
        });
        if (handled) return;

        await this.bus.publishInbound({
          sessionKey,
          channel: 'telegram',
          accountId: parsed.accountId,
          chatId: message.chatJid,
          senderId: message.senderId ?? parsed.peerId,
          content: message.content,
          metadata: {
            chatJid: message.chatJid,
            messageId: message.messageId,
            senderUsername: message.senderUsername,
          },
        });
      },
    });
  }

  async start(): Promise<void> {
    await this.channel.connect();
  }

  async stop(): Promise<void> {
    await this.channel.disconnect();
  }

  async send(delivery: OutboundDelivery): Promise<void> {
    if (delivery.type === 'typing_on') {
      await this.channel.setTyping(delivery.chatId, true);
      return;
    }
    if (delivery.type === 'typing_off') return;
    if (!delivery.content) return;
    await this.channel.sendMessage(delivery.chatId, delivery.content);
  }
}
