import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from '@main/db/migrations';

describe('MIGRATIONS', () => {
  it('loads the SQL files in version order', () => {
    expect(MIGRATIONS[0]).toMatchObject({ version: 1, name: 'initial' });
    expect(MIGRATIONS.map((m) => m.version)).toEqual(MIGRATIONS.map((_, index) => index + 1));
  });

  it('runs on a real database, including FTS5', () => {
    const db = new Database(':memory:');
    for (const { sql } of MIGRATIONS) db.exec(sql);

    db.prepare(
      "INSERT INTO tracks_fts (rowid, title, artist, album) VALUES (1, 'Café', 'Sigur Rós', 'Ágætis byrjun')",
    ).run();
    const matches = db.prepare("SELECT rowid FROM tracks_fts WHERE tracks_fts MATCH 'cafe*'").all();
    expect(matches).toEqual([{ rowid: 1 }]);

    db.close();
  });
});
