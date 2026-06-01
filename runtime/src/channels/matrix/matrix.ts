import {
  ClientEvent,
  createClient,
  EventType,
  KnownMembership,
  type MatrixClient,
  type MatrixEvent,
  type Room,
  RoomEvent,
  SyncState,
} from 'matrix-js-sdk/lib/matrix.js';

import { DirectRoomTracker } from './direct-rooms.js';
import { buildMatrixMessageContent, readMatrixMessagePlainText } from './matrix-html.js';
import { buildMatrixReactionContent } from './reactions.js';
import { buildMatrixChatId, parseMatrixTarget } from './matrix-targets.js';
import { buildReplyAwareContent, readFormattedBody, readMatrixMentions } from './reply-context.js';
import { type MatrixThreadReplies, resolveMatrixThreadRouting } from './threads.js';

export interface MatrixChannelOpts {
  homeserverUrl: string;
  accessToken: string;
  userId?: string;
  replyPrefix?: string;
  formatHtml?: boolean;
  autoJoinInvites?: boolean;
  threadReplies?: MatrixThreadReplies;
  onMessage: (message: MatrixInboundMessage) => Promise<void> | void;
  onConnected?: (userId: string) => void;
  onDisconnected?: () => void;
}

export type MatrixInboundMessage = {
  chatId: string;
  roomId: string;
  content: string;
  isFromMe: boolean;
  isDirect: boolean;
  senderId?: string;
  eventId?: string;
  threadEventId?: string;
  replyToEventId?: string;
  formattedBody?: string;
  mMentions?: { user_ids?: string[]; room?: boolean };
};

export type MatrixSendOptions = {
  replyToEventId?: string;
};

function logInfo(message: string, details?: Record<string, unknown>): void {
  console.log(`[matrix] ${message}`, details || {});
}

function logWarn(message: string, details?: Record<string, unknown>): void {
  console.warn(`[matrix] ${message}`, details || {});
}

function logError(message: string, details?: Record<string, unknown>): void {
  console.error(`[matrix] ${message}`, details || {});
}

function readThreadRootEventId(event: MatrixEvent): string | undefined {
  const relation = event.getContent()?.['m.relates_to'] as { rel_type?: string; event_id?: string } | undefined;
  if (relation?.rel_type === 'm.thread' && typeof relation.event_id === 'string') {
    return relation.event_id;
  }
  return undefined;
}

const DEFAULT_MATRIX_SYNC_TIMEOUT_MS = 120_000;

function matrixSyncTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.PORTER_MATRIX_SYNC_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MATRIX_SYNC_TIMEOUT_MS;
}

export class MatrixChannel {
  private client: MatrixClient | null = null;
  private connected = false;
  private stopped = false;
  private userId: string | null = null;
  private directRooms: DirectRoomTracker | null = null;
  private opts: MatrixChannelOpts;

  constructor(opts: MatrixChannelOpts) {
    this.opts = opts;
  }

  getUserId(): string | null {
    return this.userId;
  }

  async connect(): Promise<void> {
    if (!this.opts.homeserverUrl?.trim()) throw new Error('Matrix homeserver URL is not configured.');
    if (!this.opts.accessToken?.trim()) throw new Error('Matrix access token is not configured.');
    if (this.connected) return;

    const client = createClient({
      baseUrl: this.opts.homeserverUrl.trim().replace(/\/+$/, ''),
      accessToken: this.opts.accessToken.trim(),
      userId: this.opts.userId?.trim() || undefined,
    });
    this.client = client;

    if (!this.opts.userId?.trim()) {
      const whoami = await client.whoami();
      if (!whoami.user_id) throw new Error('Matrix client user id could not be resolved.');
      this.userId = whoami.user_id;
    } else {
      this.userId = this.opts.userId.trim();
    }

    this.directRooms = new DirectRoomTracker(client);
    this.directRooms.attach();

    if (this.opts.autoJoinInvites) {
      client.on(RoomEvent.MyMembership, (room, membership, prevMembership) => {
        if (membership !== KnownMembership.Invite || prevMembership === KnownMembership.Invite) return;
        client
          .joinRoom(room.roomId)
          .then(() => {
            logInfo('joined invited room', {
              operation: 'matrix.auto_join',
              roomId: room.roomId,
            });
          })
          .catch((error) => {
            logWarn('failed to auto-join invited room', {
              operation: 'matrix.auto_join.failed',
              roomId: room.roomId,
              err: error,
            });
          });
      });
    }

    const syncTimeoutMs = matrixSyncTimeoutMs();
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(syncTimeout);
        client.removeListener(ClientEvent.Sync, onSync);
        fn();
      };

      const onSync = (state: SyncState, _prevState: SyncState | null, data?: { error?: Error }) => {
        if (state === SyncState.Prepared) {
          this.directRooms?.refreshFromAccountData();
          client.on(RoomEvent.Timeline, (event, room, toStartOfTimeline, removed, data) => {
            if (toStartOfTimeline || removed || !room || !data?.liveEvent) return;
            this.handleTimelineEvent(event, room).catch((error) => {
              logWarn('timeline handler failed', {
                operation: 'matrix.timeline',
                err: error,
              });
            });
          });
          this.connected = true;
          this.stopped = false;
          logInfo('connected', {
            operation: 'matrix.connect',
            userId: this.userId,
          });
          if (this.userId) this.opts.onConnected?.(this.userId);
          finish(() => resolve());
        }
        if (state === SyncState.Error) {
          logError('sync failed during startup', {
            operation: 'matrix.sync.error',
            err: data?.error ?? null,
          });
          finish(() => reject(data?.error ?? new Error('Matrix sync failed during startup')));
        }
      };

      const syncTimeout = setTimeout(() => {
        try {
          client.stopClient();
        } catch (error) {
          logWarn('ignoring stopClient error after sync timeout', {
            operation: 'matrix.sync.timeout',
            err: error,
          });
        }
        finish(() => reject(new Error(`Matrix sync did not become ready within ${syncTimeoutMs}ms`)));
      }, syncTimeoutMs);

      client.on(ClientEvent.Sync, onSync);
      client.startClient({ initialSyncLimit: 20 }).catch((error) => {
        finish(() => reject(error));
      });
    });
  }

  disconnect(): Promise<void> {
    this.stopped = true;
    this.connected = false;
    this.opts.onDisconnected?.();

    const client = this.client;
    this.client = null;
    this.directRooms = null;
    if (!client) return Promise.resolve();

    try {
      client.stopClient();
    } catch (error) {
      logWarn('ignoring stopClient error during disconnect', {
        operation: 'matrix.disconnect',
        err: error,
      });
    }

    return Promise.resolve();
  }

  isConnected(): boolean {
    return this.connected;
  }

  async sendMessage(chatId: string, text: string, sendOptions?: MatrixSendOptions): Promise<void> {
    if (!this.connected || !this.client) throw new Error('Matrix channel is not connected.');

    const target = parseMatrixTarget(chatId);
    if (!target.roomId.trim()) {
      throw new Error(`invalid Matrix chat id: ${chatId}`);
    }

    const room = this.client.getRoom(target.roomId);
    const isDirect = room && this.directRooms ? this.directRooms.isDirectRoom(room) : false;
    const content = buildMatrixMessageContent({
      text,
      prefix: this.opts.replyPrefix,
      isDirect,
      formatHtml: this.opts.formatHtml,
      replyToEventId: sendOptions?.replyToEventId,
      threadEventId: target.threadEventId,
    });

    try {
      console.log('[matrix] sendMessage', {
        chatId,
        roomId: target.roomId,
        isDirect,
        replyToEventId: sendOptions?.replyToEventId ?? null,
        threadEventId: target.threadEventId ?? null,
        textLength: text.length,
      });
      await this.client.sendMessage(target.roomId, content);
      console.log('[matrix] sendMessage done', { chatId, roomId: target.roomId });
    } catch (error) {
      logWarn('send failed', {
        operation: 'matrix.send_message',
        chatId,
        roomId: target.roomId,
        err: error,
      });
      throw error;
    }
  }

  async setTyping(chatId: string, isTyping: boolean): Promise<void> {
    if (!isTyping || !this.client || !this.connected) return;

    try {
      const target = parseMatrixTarget(chatId);
      await this.client.sendTyping(target.roomId, true, 30_000);
    } catch (error) {
      logWarn('transient typing update failed', {
        operation: 'matrix.typing',
        chatId,
        err: error,
      });
    }
  }

  async reactToMessage(roomId: string, messageId: string, emoji: string): Promise<void> {
    if (!this.connected || !this.client) return;

    const trimmedMessageId = messageId.trim();
    const trimmedEmoji = emoji.trim();
    if (!trimmedMessageId || !trimmedEmoji) return;

    try {
      const content = buildMatrixReactionContent(trimmedMessageId, trimmedEmoji);
      await this.client.sendEvent(roomId, EventType.Reaction, content);
    } catch (error) {
      logWarn('ack reaction failed', {
        operation: 'matrix.ack_reaction',
        roomId,
        messageId: trimmedMessageId,
        err: error,
      });
    }
  }

  private async handleTimelineEvent(event: MatrixEvent, room: Room): Promise<void> {
    if (this.stopped || event.getType() !== EventType.RoomMessage) return;
    if (event.isRedacted()) return;

    const senderId = event.getSender() ?? undefined;
    const isFromMe = Boolean(this.userId && senderId === this.userId);
    if (isFromMe) return;

    const rawContent = event.getContent() as Record<string, unknown>;
    const msgtype = typeof rawContent.msgtype === 'string' ? rawContent.msgtype : '';
    if (msgtype !== 'm.text' && msgtype !== 'm.notice') return;

    const userContent = readMatrixMessagePlainText(rawContent);
    if (!userContent.trim()) return;

    const client = this.client;
    if (!client) return;

    const { content, replyToEventId } = await buildReplyAwareContent(client, room, event, userContent);

    const roomId = room.roomId;
    const isDirect = this.directRooms?.isDirectRoom(room) ?? false;
    const messageId = event.getId() ?? '';
    const threadRootId = readThreadRootEventId(event);
    // Session-per-thread routing (default always): ./docs/matrix.md#threads
    const { threadId } = resolveMatrixThreadRouting({
      isDirectMessage: isDirect,
      threadReplies: this.opts.threadReplies ?? 'always',
      messageId,
      threadRootId,
    });
    const chatId = buildMatrixChatId(roomId, { threadEventId: threadId, isDirect });

    await this.opts.onMessage({
      chatId,
      roomId,
      content,
      isFromMe,
      isDirect,
      senderId,
      eventId: messageId || undefined,
      threadEventId: threadId,
      replyToEventId,
      formattedBody: readFormattedBody(rawContent),
      mMentions: readMatrixMentions(rawContent),
    });
  }
}
