import type { ParsedSessionKey } from '../routing/session-key.js';
import type { Db } from './client.js';

export class SessionStore {
  private db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async ensureSession(sessionKey: string, parsed: ParsedSessionKey): Promise<void> {
    await this.db`
      insert into sessions (
        session_key,
        agent_id,
        channel,
        account_id,
        peer_kind,
        peer_id,
        thread_id
      ) values (
        ${sessionKey},
        ${parsed.agentId},
        ${parsed.source},
        ${parsed.accountId},
        ${parsed.peerKind},
        ${parsed.peerId},
        ${parsed.threadId ?? null}
      )
      on conflict (session_key)
      do update set updated_at = now()
    `;
  }

  async bumpMessageCount(sessionKey: string, delta = 1): Promise<void> {
    if (delta < 0) throw new Error('delta must be non-negative');

    await this.db`
      update sessions
      set message_count = message_count + ${delta}, updated_at = now()
      where session_key = ${sessionKey}
    `;
  }
}
