import type { PostgresBus } from '../../bus/postgres-bus.js';
import type { OutboundDelivery } from '../../bus/types.js';
import { SessionArchiveStore } from '../../db/session-archive-store.js';
import { SessionStore } from '../../db/session-store.js';
import { parseSessionKey } from '../../routing/session-key.js';
import type { ChannelRuntime } from '../types.js';
import { MatrixAccessControl } from './access.js';
import { handleMatrixCommand, isMatrixSlashCommand } from './commands.js';
import { MatrixChannel } from './matrix.js';
import { isMatrixMentioned, stripMatrixMentionPrefix } from './mentions.js';
import { buildMatrixSessionKey } from './session.js';

export type MatrixRuntimeOptions = {
  bus: PostgresBus;
  sessionStore: SessionStore;
  sessionArchiveStore: SessionArchiveStore;
  sessionRoot: string;
  homeserverUrl: string;
  accessToken: string;
  userId?: string;
  allowedSenders: string[];
  allowedRooms: string[];
  autoJoinInvites: boolean;
  requireMention: boolean;
  replyPrefix: string;
  formatHtml: boolean;
};

export class MatrixRuntime implements ChannelRuntime {
  readonly id = 'matrix' as const;
  private access: MatrixAccessControl;
  private bus: PostgresBus;
  private sessionStore: SessionStore;
  private sessionArchiveStore: SessionArchiveStore;
  private sessionRoot: string;
  private requireMention: boolean;
  private channel: MatrixChannel;

  constructor(options: MatrixRuntimeOptions) {
    this.access = new MatrixAccessControl(options.allowedSenders, options.allowedRooms);
    this.bus = options.bus;
    this.sessionStore = options.sessionStore;
    this.sessionArchiveStore = options.sessionArchiveStore;
    this.sessionRoot = options.sessionRoot;
    this.requireMention = options.requireMention;
    this.channel = new MatrixChannel({
      homeserverUrl: options.homeserverUrl,
      accessToken: options.accessToken,
      userId: options.userId,
      replyPrefix: options.replyPrefix,
      formatHtml: options.formatHtml,
      autoJoinInvites: options.autoJoinInvites,
      onMessage: async (message) => {
        if (message.isFromMe) return;

        const senderAccess = this.access.checkSender(message.senderId ?? '');
        if (!senderAccess.allowed) {
          console.warn('[matrix] rejected inbound message', {
            operation: 'matrix.access_denied',
            reason: senderAccess.reason,
            senderId: message.senderId ?? null,
            roomId: message.roomId,
          });
          return;
        }

        const roomAccess = this.access.checkRoom(message.roomId, message.isDirect);
        if (!roomAccess.allowed) {
          console.warn('[matrix] rejected inbound message', {
            operation: 'matrix.room_denied',
            reason: roomAccess.reason,
            roomId: message.roomId,
            isDirect: message.isDirect,
          });
          return;
        }

        const sessionKey = buildMatrixSessionKey(message.chatId, { isDirect: message.isDirect });
        const parsed = parseSessionKey(sessionKey);
        if (!parsed) throw new Error(`failed to parse generated Matrix session key: ${sessionKey}`);

        await this.sessionStore.ensureSession(sessionKey, parsed);

        const handled = await handleMatrixCommand({
          bus: this.bus,
          sessionArchiveStore: this.sessionArchiveStore,
          sessionRoot: this.sessionRoot,
          sessionKey,
          senderId: message.senderId ?? parsed.peerId,
          chatId: message.chatId,
          content: message.content,
          message,
        });
        if (handled) return;

        const botUserId = this.channel.getUserId() ?? options.userId ?? '';
        if (
          this.requireMention &&
          !message.isDirect &&
          !isMatrixSlashCommand(message.content) &&
          !isMatrixMentioned({
            body: message.content,
            formattedBody: message.formattedBody,
            mMentions: message.mMentions,
            botUserId,
          })
        ) {
          return;
        }

        let agentContent = message.content;
        if (!message.isDirect && botUserId) {
          agentContent = stripMatrixMentionPrefix(message.content, botUserId);
        }

        const inboundId = await this.bus.publishMatrixInbound({
          sessionKey,
          channel: 'matrix',
          accountId: parsed.accountId,
          chatId: message.chatId,
          senderId: message.senderId ?? parsed.peerId,
          content: agentContent,
          metadata: {
            chatId: message.chatId,
            roomId: message.roomId,
            eventId: message.eventId,
            threadEventId: message.threadEventId,
            replyToEventId: message.replyToEventId,
            isDirect: message.isDirect,
          },
        });
        if (inboundId == null) return;
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

    const replyToEventId =
      typeof delivery.metadata.replyToEventId === 'string' ? delivery.metadata.replyToEventId : undefined;
    await this.channel.sendMessage(delivery.chatId, delivery.content, { replyToEventId });
  }
}
