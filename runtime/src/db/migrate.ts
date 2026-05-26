import { closeDb, type Db, getDb } from './client.js';
import { embeddedMigrations } from './embedded-migrations.js';

export async function migrate(db: Db): Promise<void> {
  await db`create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())`;

  await db`select pg_advisory_lock(hashtext('porter:migrations')::bigint)`;
  try {
    for (const migration of embeddedMigrations) {
      const applied = (await db`
        select version from schema_migrations where version = ${migration.version}
      `) as { version: string }[];
      if (applied.length > 0) continue;

      const sqlText = await Bun.file(migration.path).text();
      await db.begin(async (tx) => {
        await tx.unsafe(sqlText);
        await tx`insert into schema_migrations (version) values (${migration.version})`;
      });
      console.log(`[db] applied migration ${migration.version}`);
    }
  } finally {
    await db`select pg_advisory_unlock(hashtext('porter:migrations')::bigint)`;
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
