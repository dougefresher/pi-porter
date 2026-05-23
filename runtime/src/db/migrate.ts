import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../config.js';
import { closeDb, createDb, type Db } from './client.js';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function migrate(db: Db): Promise<void> {
  await db`create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())`;

  await db`select pg_advisory_lock(hashtext('suka:migrations')::bigint)`;
  try {
    const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();
    for (const file of files) {
      const applied = await db<{ version: string }[]>`select version from schema_migrations where version = ${file}`;
      if (applied.length > 0) continue;

      const sql = await readFile(join(migrationsDir, file), 'utf8');
      await db.begin(async (tx) => {
        await tx.unsafe(sql);
        await tx`insert into schema_migrations (version) values (${file})`;
      });
      console.log(`[db] applied migration ${file}`);
    }
  } finally {
    await db`select pg_advisory_unlock(hashtext('suka:migrations')::bigint)`;
  }
}

if (import.meta.main) {
  const config = loadConfig();
  const db = createDb(config.databaseUrl);
  try {
    await migrate(db);
  } finally {
    await closeDb(db);
  }
}
