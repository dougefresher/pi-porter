import type { Db } from './client.js';

export class ChannelWorkdirStore {
  private db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async get(roomId: string): Promise<string | null> {
    const rows = (await this.db`
      select path from channel_workdirs where room_id = ${roomId}
    `) as { path: string }[];
    return rows[0]?.path ?? null;
  }

  async set(roomId: string, path: string): Promise<void> {
    await this.db`
      insert into channel_workdirs (room_id, path)
      values (${roomId}, ${path})
      on conflict (room_id) do update set path = excluded.path
    `;
  }

  async delete(roomId: string): Promise<void> {
    await this.db`delete from channel_workdirs where room_id = ${roomId}`;
  }
}
