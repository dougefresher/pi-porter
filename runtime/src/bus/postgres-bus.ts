import type { Db } from '../db/client.js';
import type { InboundEvent, NewInboundEvent, NewOutboundDelivery, OutboundDelivery } from './types.js';

type JsonObject = Record<string, unknown>;

function mapInbound(row: Record<string, unknown>): InboundEvent {
  return {
    id: Number(row.id),
    sessionKey: String(row.session_key),
    channel: String(row.channel),
    accountId: String(row.account_id),
    chatId: String(row.chat_id),
    senderId: String(row.sender_id),
    content: String(row.content),
    attachments: Array.isArray(row.attachments) ? row.attachments : [],
    metadata: row.metadata && typeof row.metadata === 'object' ? (row.metadata as JsonObject) : {},
    status: row.status as InboundEvent['status'],
    createdAt: row.created_at as Date,
    processedAt: (row.processed_at as Date | null) ?? null,
    error: (row.error as string | null) ?? null,
  };
}

function mapOutbound(row: Record<string, unknown>): OutboundDelivery {
  return {
    id: Number(row.id),
    inboundId: row.inbound_id == null ? null : Number(row.inbound_id),
    sessionKey: String(row.session_key),
    channel: String(row.channel),
    accountId: String(row.account_id),
    chatId: String(row.chat_id),
    type: row.type as OutboundDelivery['type'],
    content: (row.content as string | null) ?? null,
    media: row.media && typeof row.media === 'object' ? (row.media as JsonObject) : null,
    metadata: row.metadata && typeof row.metadata === 'object' ? (row.metadata as JsonObject) : {},
    status: row.status as OutboundDelivery['status'],
    attempts: Number(row.attempts),
    createdAt: row.created_at as Date,
    sentAt: (row.sent_at as Date | null) ?? null,
    error: (row.error as string | null) ?? null,
  };
}

export class PostgresBus {
  private db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async publishInbound(event: NewInboundEvent): Promise<number> {
    const rows = (await this.db`
      insert into inbound_events (
        session_key,
        channel,
        account_id,
        chat_id,
        sender_id,
        content,
        attachments,
        metadata
      ) values (
        ${event.sessionKey},
        ${event.channel},
        ${event.accountId},
        ${event.chatId},
        ${event.senderId},
        ${event.content},
        ${event.attachments ?? []},
        ${event.metadata ?? {}}
      )
      returning id
    `) as { id: number }[];
    const row = rows[0];
    if (!row) throw new Error('failed to publish inbound event');
    await this.db`select pg_notify('porter_inbound', ${String(row.id)})`;
    return row.id;
  }

  async claimInbound(): Promise<InboundEvent | null> {
    const rows = (await this.db`
      update inbound_events
      set status = 'processing', processed_at = now()
      where id = (
        select id from inbound_events
        where status = 'pending'
        order by created_at, id
        for update skip locked
        limit 1
      )
      returning *
    `) as Record<string, unknown>[];
    const row = rows[0];
    return row ? mapInbound(row) : null;
  }

  async markInboundDone(id: number): Promise<void> {
    await this.db`update inbound_events set status = 'done', processed_at = now(), error = null where id = ${id}`;
  }

  async markInboundFailed(id: number, error: unknown): Promise<void> {
    await this.db`
      update inbound_events
      set status = 'failed', processed_at = now(), error = ${String(error instanceof Error ? error.stack || error.message : error)}
      where id = ${id}
    `;
  }

  async publishOutbound(delivery: NewOutboundDelivery): Promise<number> {
    const rows = (await this.db`
      insert into outbound_deliveries (
        inbound_id,
        session_key,
        channel,
        account_id,
        chat_id,
        type,
        content,
        media,
        metadata
      ) values (
        ${delivery.inboundId ?? null},
        ${delivery.sessionKey},
        ${delivery.channel},
        ${delivery.accountId},
        ${delivery.chatId},
        ${delivery.type ?? 'message'},
        ${delivery.content ?? null},
        ${delivery.media ?? {}},
        ${delivery.metadata ?? {}}
      )
      returning id
    `) as { id: number }[];
    const row = rows[0];
    if (!row) throw new Error('failed to publish outbound delivery');
    await this.db`select pg_notify('porter_outbound', ${String(row.id)})`;
    return row.id;
  }

  async claimOutbound(): Promise<OutboundDelivery | null> {
    const rows = (await this.db`
      update outbound_deliveries
      set status = 'processing', attempts = attempts + 1
      where id = (
        select id from outbound_deliveries
        where status = 'pending'
        order by created_at, id
        for update skip locked
        limit 1
      )
      returning *
    `) as Record<string, unknown>[];
    const row = rows[0];
    return row ? mapOutbound(row) : null;
  }

  async markOutboundSent(id: number): Promise<void> {
    await this.db`update outbound_deliveries set status = 'sent', sent_at = now(), error = null where id = ${id}`;
  }

  async markOutboundFailed(id: number, error: unknown): Promise<void> {
    await this.db`
      update outbound_deliveries
      set status = 'failed', error = ${String(error instanceof Error ? error.stack || error.message : error)}
      where id = ${id}
    `;
  }
}
