import type { PostgresBus } from '../../bus/postgres-bus.js';
import type { OutboundDelivery } from '../../bus/types.js';
import type { ChannelWorkdirStore } from '../../db/channel-workdir-store.js';
import { SessionArchiveStore } from '../../db/session-archive-store.js';
import { SessionStore } from '../../db/session-store.js';
import { parseSessionKey } from '../../routing/session-key.js';
import type { ChannelRuntime } from '../types.js';
import { MatrixAccessControl } from './access.js';
import { handleMatrixCommand, isMatrixSlashCommand } from './commands.js';
import { MatrixChannel } from './matrix.js';
import { isMatrixMentioned, stripMatrixMentionPrefix } from './mentions.js';
import { buildMatrixSessionKey } from './session.js';
import { parseMatrixTarget } from './matrix-targets.js';
import type { MatrixThreadReplies } from './threads.js';

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
  threadReplies: MatrixThreadReplies;
  workdirStore?: ChannelWorkdirStore;
};

export class MatrixRuntime implements ChannelRuntime {
  readonly id = 'matrix' as const;
  private access: MatrixAccessControl;
  private bus: PostgresBus;
  private sessionStore: SessionStore;
  private sessionArchiveStore: SessionArchiveStore;
  private sessionRoot: string;
  private requireMention: boolean;
  private workdirStore: ChannelWorkdirStore | undefined;
  private channel: MatrixChannel;

  constructor(options: MatrixRuntimeOptions) {
    this.access = new MatrixAccessControl(options.allowedSenders, options.allowedRooms);
    this.bus = options.bus;
    this.sessionStore = options.sessionStore;
    this.sessionArchiveStore = options.sessionArchiveStore;
    this.sessionRoot = options.sessionRoot;
    this.requireMention = options.requireMention;
    this.workdirStore = options.workdirStore;
    this.channel = new MatrixChannel({
      homeserverUrl: options.homeserverUrl,
      accessToken: options.accessToken,
      userId: options.userId,
      replyPrefix: options.replyPrefix,
      formatHtml: options.formatHtml,
      autoJoinInvites: options.autoJoinInvites,
      threadReplies: options.threadReplies,
      onMessage: async (message) => {
        if (message.isFromMe) return;

        console.log('[matrix] inbound message', {
          chatId: message.chatId,
          roomId: message.roomId,
          senderId: message.senderId,
          eventId: message.eventId,
          isDirect: message.isDirect,
          threadEventId: message.threadEventId ?? null,
          replyToEventId: message.replyToEventId ?? null,
          contentLength: message.content.length,
        });

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
          workdirStore: this.workdirStore,
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
          console.log('[matrix] message skipped (mention required)', {
            roomId: message.roomId,
            senderId: message.senderId,
            eventId: message.eventId,
            threadEventId: message.threadEventId,
            replyToEventId: message.replyToEventId,
            isDirect: message.isDirect,
          });
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
        if (inboundId == null) {
          console.log('[matrix] inbound deduped (skipped)', {
            sessionKey,
            eventId: message.eventId,
          });
          return;
        }
        console.log('[matrix] inbound published', {
          inboundId,
          sessionKey,
          roomId: message.roomId,
          eventId: message.eventId,
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
      console.log('[matrix] send typing_on', { chatId: delivery.chatId });
      await this.channel.setTyping(delivery.chatId, true);
      return;
    }
    if (delivery.type === 'typing_off') return;
    if (!delivery.content) return;

    const target = parseMatrixTarget(delivery.chatId);
    const replyToEventId =
      target.threadEventId || typeof delivery.metadata.replyToEventId !== 'string'
        ? undefined
        : delivery.metadata.replyToEventId;

    console.log('[matrix] send message', {
      chatId: delivery.chatId,
      outboundId: delivery.id,
      replyToEventId: replyToEventId ?? null,
      threadEventId: target.threadEventId ?? null,
      contentLength: delivery.content.length,
    });
    await this.channel.sendMessage(delivery.chatId, delivery.content, { replyToEventId });
  }
}
