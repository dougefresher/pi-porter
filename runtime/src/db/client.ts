import postgres from 'postgres';

export type Db = ReturnType<typeof postgres>;

export function createDb(url: string): Db {
  if (!url.trim()) {
    throw new Error('SUKA_DATABASE_URL is required. PostgreSQL is the only supported database.');
  }

  return postgres(url, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
  });
}

export async function closeDb(db: Db): Promise<void> {
  await db.end({ timeout: 5 });
}
