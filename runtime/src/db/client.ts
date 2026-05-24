import type { SQL } from 'bun';
import { sql } from 'bun';

export type Db = SQL;

const POSTGRES_URL_PREFIXES = ['postgres://', 'postgresql://'] as const;

function assertPostgresDatabaseUrl(): void {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required and must be a PostgreSQL connection URL (postgres:// or postgresql://)');
  }

  const lower = databaseUrl.toLowerCase();
  if (!POSTGRES_URL_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
    throw new Error(
      `DATABASE_URL must use postgres:// or postgresql://; got: ${databaseUrl.split('://')[0] ?? 'invalid'}://`,
    );
  }
}

export function getDb(): Db {
  assertPostgresDatabaseUrl();
  return sql;
}

export async function closeDb(db: Db): Promise<void> {
  await db.close({ timeout: 5 });
}
