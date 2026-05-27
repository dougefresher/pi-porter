import migration0001 from './migrations/0001_init.sql' with { type: 'file' };

export type EmbeddedMigration = {
  version: string;
  path: string;
};

/** SQL migrations bundled at build time; add one import per new migration file. */
export const embeddedMigrations: EmbeddedMigration[] = [{ version: '0001_init.sql', path: migration0001 }];
