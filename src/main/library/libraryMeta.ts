import type { LastChanged } from '@shared/domain';
import type { Connection } from '@main/db/connection';

/** Which machine changed the library last, and when. Only real changes count: a rescan that found nothing isn't one. */
export function createLibraryMeta(db: Connection) {
  const select = db.prepare<[string], { value: string }>('SELECT value FROM library_meta WHERE key = ?');
  const upsert = db.prepare<[string, string]>(
    'INSERT INTO library_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  );
  const value = (key: string) => select.get(key)?.value ?? null;

  return {
    lastScanAt: (): number | null => {
      const at = value('last_scan_at');
      return at === null ? null : Number(at);
    },
    setLastScanAt: (at: number): void => {
      upsert.run('last_scan_at', String(at));
    },
    lastChanged: (): LastChanged | null => {
      const at = value('last_changed_at');
      const host = value('last_changed_host');
      return at === null || host === null ? null : { at: Number(at), host };
    },
    markChanged: (at: number, host: string): void => {
      upsert.run('last_changed_at', String(at));
      upsert.run('last_changed_host', host);
    },
  };
}
