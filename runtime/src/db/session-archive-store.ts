import type { Db } from './client.js';

const ZSTD_LEVEL = 3;

export type SessionArchive = {
  id: number;
  sessionKey: string;
  reason: string;
  piSessionId: string | null;
  lineCount: number;
  contentBytes: number;
  createdAt: Date;
};

function compressContent(content: string): { compressed: Uint8Array; contentBytes: number } {
  const raw = Buffer.from(content, 'utf8');
  return {
    compressed: Bun.zstdCompressSync(raw, { level: ZSTD_LEVEL }),
    contentBytes: raw.byteLength,
  };
}

function decompressContent(compressed: Buffer | Uint8Array): string {
  const raw = Bun.zstdDecompressSync(compressed);
  return Buffer.from(raw).toString('utf8');
}

function mapArchive(row: Record<string, unknown>): SessionArchive {
  return {
    id: Number(row.id),
    sessionKey: String(row.session_key),
    reason: String(row.reason),
    piSessionId: (row.pi_session_id as string | null) ?? null,
    lineCount: Number(row.line_count),
    contentBytes: Number(row.content_bytes),
    createdAt: row.created_at as Date,
  };
}

export class SessionArchiveStore {
  private db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async archive(params: {
    sessionKey: string;
    reason: string;
    piSessionId?: string | null;
    lineCount: number;
    content: string;
  }): Promise<number> {
    const { compressed, contentBytes } = compressContent(params.content);

    try {
      return await this.db.begin(async (tx) => {
        const rows = (await tx`
          insert into session_archives (
            session_key,
            reason,
            pi_session_id,
            line_count,
            content_bytes
          ) values (
            ${params.sessionKey},
            ${params.reason},
            ${params.piSessionId ?? null},
            ${params.lineCount},
            ${contentBytes}
          )
          returning id
        `) as { id: number }[];

        const archiveId = rows[0]?.id;
        if (archiveId == null) {
          throw new Error('session archive insert did not return id');
        }

        await tx`
          insert into session_archive_contents (
            archive_id,
            content
          ) values (
            ${archiveId},
            ${compressed}
          )
        `;

        return archiveId;
      });
    } catch (error) {
      console.error('[db] session archive insert failed', {
        sessionKey: params.sessionKey,
        reason: params.reason,
        lineCount: params.lineCount,
        contentBytes,
        error,
      });
      throw error;
    }
  }

  async getById(archiveId: number): Promise<SessionArchive | null> {
    const rows = (await this.db`
      select * from session_archives where id = ${archiveId}
    `) as Record<string, unknown>[];
    const row = rows[0];
    return row ? mapArchive(row) : null;
  }

  async listBySessionKey(sessionKey: string, limit = 20): Promise<SessionArchive[]> {
    const rows = (await this.db`
      select * from session_archives
      where session_key = ${sessionKey}
      order by id desc
      limit ${limit}
    `) as Record<string, unknown>[];
    return rows.map(mapArchive);
  }

  async readContent(archiveId: number): Promise<string | null> {
    const rows = (await this.db`
      select content from session_archive_contents where archive_id = ${archiveId}
    `) as { content: Buffer | Uint8Array }[];
    const row = rows[0];
    if (!row) return null;
    return decompressContent(row.content);
  }
}
