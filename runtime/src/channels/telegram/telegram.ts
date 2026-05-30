import { isRecoverableTelegramNetworkError } from './telegram-network-errors.js';
import { resolveTelegramLongPollTimeoutSeconds } from './telegram-request-timeouts.js';
import { buildTelegramChatJid, parseTelegramTarget } from './telegram-targets.js';

export interface TelegramChannelOpts {
  botToken: string;
  pollingTimeoutSeconds?: number;
  assistantName?: string;
  onMessage: (message: TelegramInboundMessage) => Promise<void> | void;
  onConnected?: (botUsername?: string) => void;
  onDisconnected?: () => void;
}

export type TelegramInboundMessage = {
  chatJid: string;
  content: string;
  isFromMe: boolean;
  senderId?: string;
  senderUsername?: string;
  messageId?: string;
};

type TelegramApiLike = {
  getMe(): Promise<{ id: number; username?: string }>;
  getUpdates(params: {
    offset?: number;
    timeout?: number;
    allowed_updates?: string[];
  }): Promise<Array<Record<string, unknown>>>;
  sendMessage(chatId: string | number, text: string, params?: { message_thread_id?: number }): Promise<unknown>;
  sendChatAction(chatId: string | number, action: 'typing', params?: { message_thread_id?: number }): Promise<unknown>;
};

function logInfo(message: string, details?: Record<string, unknown>): void {
  console.log(`[telegram] ${message}`, details || {});
}

function logWarn(message: string, details?: Record<string, unknown>): void {
  console.warn(`[telegram] ${message}`, details || {});
}

function logError(message: string, details?: Record<string, unknown>): void {
  console.error(`[telegram] ${message}`, details || {});
}

export class TelegramChannel {
  private api: TelegramApiLike | null = null;
  private connected = false;
  private pollingPromise: Promise<void> | null = null;
  private stopped = false;
  private reconnectAttempts = 0;
  private lastUpdateId = 0;
  private botId: number | null = null;

  private opts: TelegramChannelOpts;

  constructor(opts: TelegramChannelOpts) {
    this.opts = {
      ...opts,
      pollingTimeoutSeconds: opts.pollingTimeoutSeconds ?? 30,
      assistantName: opts.assistantName || process.env.PICLAW_ASSISTANT_NAME || process.env.ASSISTANT_NAME || 'Pi',
    };
  }

  async connect(): Promise<void> {
    if (!this.opts.botToken?.trim()) throw new Error('Telegram bot token is not configured.');
    if (this.connected) return;

    const mod = await import('grammy');
    const api = new mod.Api(this.opts.botToken);
    this.api = api as unknown as TelegramApiLike;

    const me = await this.api.getMe();
    this.botId = me.id;
    this.connected = true;
    this.stopped = false;
    this.reconnectAttempts = 0;

    logInfo('connected', {
      operation: 'telegram.connect',
      botId: me.id,
      username: me.username || null,
    });

    this.opts.onConnected?.(me.username);
    this.pollingPromise = this.pollLoop();
  }

  async disconnect(): Promise<void> {
    this.stopped = true;
    this.connected = false;
    this.opts.onDisconnected?.();

    const pending = this.pollingPromise;
    this.pollingPromise = null;

    await pending?.catch((error) => {
      logWarn('ignoring poll-loop error during disconnect', {
        operation: 'telegram.disconnect',
        err: error,
      });
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.connected || !this.api) throw new Error('Telegram channel is not connected.');

    try {
      const target = parseTelegramTarget(jid);
      const messageText = `${this.opts.assistantName}: ${text}`;
      console.log('[telegram] sendMessage', {
        jid,
        chatId: target.chatId,
        messageThreadId: target.messageThreadId ?? null,
        textLength: text.length,
      });
      await this.api.sendMessage(target.chatId, messageText, {
        ...(typeof target.messageThreadId === 'number' ? { message_thread_id: target.messageThreadId } : {}),
      });
      console.log('[telegram] sendMessage done', { jid, chatId: target.chatId });
    } catch (error) {
      logWarn('send failed', {
        operation: 'telegram.send_message',
        jid,
        err: error,
      });
      throw error;
    }
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    if (!isTyping || !this.api || !this.connected) return;

    try {
      const target = parseTelegramTarget(jid);
      await this.api.sendChatAction(target.chatId, 'typing', {
        ...(typeof target.messageThreadId === 'number' ? { message_thread_id: target.messageThreadId } : {}),
      });
    } catch (error) {
      logWarn('transient typing update failed', {
        operation: 'telegram.typing',
        jid,
        err: error,
      });
    }
  }

  private async pollLoop(): Promise<void> {
    while (!this.stopped && this.connected && this.api) {
      try {
        const updates = await this.api.getUpdates({
          offset: this.lastUpdateId > 0 ? this.lastUpdateId + 1 : undefined,
          timeout: resolveTelegramLongPollTimeoutSeconds(this.opts.pollingTimeoutSeconds),
          allowed_updates: ['message', 'edited_message'],
        });

        for (const update of updates) {
          const updateId = Number((update as { update_id?: unknown }).update_id);
          if (Number.isFinite(updateId)) this.lastUpdateId = Math.max(this.lastUpdateId, updateId);

          const message = ((update as { message?: unknown; edited_message?: unknown }).message ||
            (update as { message?: unknown; edited_message?: unknown }).edited_message) as
            | Record<string, unknown>
            | undefined;
          if (!message) continue;

          const chat = message.chat as { id?: unknown } | undefined;
          const chatIdRaw = chat?.id;
          if (chatIdRaw === undefined || chatIdRaw === null) continue;

          const messageThreadId = Number(message.message_thread_id);
          const text =
            typeof message.text === 'string'
              ? message.text
              : typeof message.caption === 'string'
                ? message.caption
                : '';
          if (!text.trim()) continue;

          const from = message.from as { id?: unknown; username?: unknown } | undefined;
          const senderId = from?.id != null ? Number(from.id) : null;
          const isFromMe = Number.isFinite(senderId) && this.botId != null ? senderId === this.botId : false;

          const chatJid = buildTelegramChatJid(
            String(chatIdRaw),
            Number.isFinite(messageThreadId) ? messageThreadId : undefined,
          );

          await this.opts.onMessage({
            chatJid,
            content: text,
            isFromMe,
            senderId: Number.isFinite(senderId) ? String(senderId) : undefined,
            senderUsername: typeof from?.username === 'string' ? from.username : undefined,
            messageId:
              message.message_id == null || typeof message.message_id === 'object'
                ? undefined
                : String(message.message_id),
          });
        }
      } catch (error) {
        if (this.stopped || !this.connected) return;

        if (!isRecoverableTelegramNetworkError(error)) {
          logError('polling failed', {
            operation: 'telegram.polling',
            err: error,
          });
          throw error;
        }

        this.reconnectAttempts += 1;
        const delay = Math.min(30_000, 1_000 * 2 ** Math.min(this.reconnectAttempts, 5));

        logWarn('polling transient failure; retrying', {
          operation: 'telegram.polling.retry',
          reconnectAttempts: this.reconnectAttempts,
          delayMs: delay,
          err: error,
        });
        await Bun.sleep(delay);
      }
    }
  }
}
