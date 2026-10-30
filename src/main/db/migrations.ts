export type Migration = {
  version: number;
  name: string;
  sql: string;
};

const sqlFiles = import.meta.glob<string>('./migrations/*.sql', { query: '?raw', import: 'default', eager: true });

function toMigration(path: string, sql: string): Migration {
  const match = /(\d+)_([^/]+)\.sql$/.exec(path);
  if (!match?.[1] || !match[2]) throw new Error(`Migration files are named NNN_description.sql, got ${path}`);
  return { version: Number(match[1]), name: match[2], sql };
}

export const MIGRATIONS: Migration[] = Object.entries(sqlFiles)
  .map(([path, sql]) => toMigration(path, sql))
  .toSorted((a, b) => a.version - b.version);
