import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { closeDb, type Db, getDb } from './client.js';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function migrate(db: Db): Promise<void> {
  await db`create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())`;

  await db`select pg_advisory_lock(hashtext('suka:migrations')::bigint)`;
  try {
    const files = (await Array.fromAsync(new Bun.Glob('*.sql').scan({ cwd: migrationsDir }))).sort();
    for (const file of files) {
      const applied = (await db`
        select version from schema_migrations where version = ${file}
      `) as { version: string }[];
      if (applied.length > 0) continue;

      const sqlText = await Bun.file(join(migrationsDir, file)).text();
      await db.begin(async (tx) => {
        await tx.unsafe(sqlText);
        await tx`insert into schema_migrations (version) values (${file})`;
      });
      console.log(`[db] applied migration ${file}`);
    }
  } finally {
    await db`select pg_advisory_unlock(hashtext('suka:migrations')::bigint)`;
  }
}

if (import.meta.main) {
  const db = getDb();
  try {
    await migrate(db);
  } finally {
    await closeDb(db);
  }
}
