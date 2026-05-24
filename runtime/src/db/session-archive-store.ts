import type { Db } from './client.js';

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
  }): Promise<void> {
    try {
      await this.db`
        insert into session_archives (
          session_key,
          reason,
          pi_session_id,
          line_count,
          content
        ) values (
          ${params.sessionKey},
          ${params.reason},
          ${params.piSessionId ?? null},
          ${params.lineCount},
          ${params.content}
        )
      `;
    } catch (error) {
      console.error('[db] session archive insert failed', {
        sessionKey: params.sessionKey,
        reason: params.reason,
        lineCount: params.lineCount,
        error,
      });
      throw error;
    }
  }
}
