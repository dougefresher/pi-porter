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

import { buildMatrixChatId, parseMatrixTarget } from './matrix-targets.js';

export interface MatrixChannelOpts {
  homeserverUrl: string;
  accessToken: string;
  userId?: string;
  assistantName?: string;
  autoJoinInvites?: boolean;
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

function readMessageBody(event: MatrixEvent): string {
  const content = event.getContent();
  const msgtype = typeof content.msgtype === 'string' ? content.msgtype : '';
  if (msgtype !== 'm.text' && msgtype !== 'm.notice') return '';
  return typeof content.body === 'string' ? content.body : '';
}

function readThreadRootEventId(event: MatrixEvent): string | undefined {
  const relation = event.getContent()?.['m.relates_to'] as { rel_type?: string; event_id?: string } | undefined;
  if (relation?.rel_type === 'm.thread' && typeof relation.event_id === 'string') {
    return relation.event_id;
  }
  return undefined;
}

function isDirectRoom(room: Room): boolean {
  return room.getJoinedMemberCount() === 2;
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
  private opts: MatrixChannelOpts;

  constructor(opts: MatrixChannelOpts) {
    this.opts = {
      ...opts,
      assistantName: opts.assistantName || process.env.PICLAW_ASSISTANT_NAME || process.env.ASSISTANT_NAME || 'Pi',
    };
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

  async sendMessage(chatId: string, text: string): Promise<void> {
    if (!this.connected || !this.client) throw new Error('Matrix channel is not connected.');

    const target = parseMatrixTarget(chatId);
    if (!target.roomId.trim()) {
      throw new Error(`invalid Matrix chat id: ${chatId}`);
    }
    const messageText = `${this.opts.assistantName}: ${text}`;

    try {
      await this.client.sendTextMessage(target.roomId, messageText);
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

  private async handleTimelineEvent(event: MatrixEvent, room: Room): Promise<void> {
    if (this.stopped || event.getType() !== EventType.RoomMessage) return;
    if (event.isRedacted()) return;

    const senderId = event.getSender() ?? undefined;
    const isFromMe = Boolean(this.userId && senderId === this.userId);
    if (isFromMe) return;

    const content = readMessageBody(event);
    if (!content.trim()) return;

    const roomId = room.roomId;
    const isDirect = isDirectRoom(room);
    const threadEventId = readThreadRootEventId(event);
    const chatId = buildMatrixChatId(roomId, { threadEventId, isDirect });

    await this.opts.onMessage({
      chatId,
      roomId,
      content,
      isFromMe,
      isDirect,
      senderId,
      eventId: event.getId() ?? undefined,
      threadEventId,
    });
  }
}
