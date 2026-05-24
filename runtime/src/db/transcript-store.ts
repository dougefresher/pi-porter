import type { Db } from './client.js';

type JsonObject = Record<string, unknown>;

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
    const rows = (await this.db`
      insert into transcript_rows (session_key, inbound_id, role, content, payload)
      values (
        ${params.sessionKey},
        ${params.inboundId ?? null},
        ${params.role},
        ${params.content ?? null},
        ${params.payload ?? {}}
      )
      returning id
    `) as { id: number }[];
    const row = rows[0];
    if (!row) throw new Error('failed to append transcript row');
    return row.id;
  }
}
