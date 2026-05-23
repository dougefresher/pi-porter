import type { Db } from './client.js';

type JsonObject = Record<string, unknown>;

function toJson(value: JsonObject): never {
  return value as never;
}

export class TranscriptStore {
  private db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async append(params: {
    sessionKey: string;
    inboundId?: number | null;
    role: 'user' | 'assistant' | 'system' | 'tool' | 'context';
    content?: string | null;
    payload?: JsonObject;
  }): Promise<number> {
    const rows = await this.db<{ id: number }[]>`
      insert into transcript_rows (session_key, inbound_id, role, content, payload)
      values (
        ${params.sessionKey},
        ${params.inboundId ?? null},
        ${params.role},
        ${params.content ?? null},
        ${this.db.json(toJson(params.payload ?? {}))}
      )
      returning id
    `;
    const row = rows[0];
    if (!row) throw new Error('failed to append transcript row');
    return row.id;
  }
}
