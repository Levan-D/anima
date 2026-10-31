import * as z from 'zod';
import type { LastChanged, ScanReport } from '@shared/domain';
import type { Connection } from '@main/db/connection';

// A database travels between machines and versions of the app, so what's in it gets checked like anything from outside.
const scanReportSchema = z.object({
  finishedAt: z.number(),
  durationMs: z.number(),
  cancelled: z.boolean(),
  looksEmpty: z.boolean(),
  added: z.number(),
  updated: z.number(),
  moved: z.number(),
  nowMissing: z.number(),
  restored: z.number(),
  unchanged: z.number(),
  issues: z.number(),
});

function parseScanReport(text: string): ScanReport | null {
  try {
    const parsed = scanReportSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

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
    lastScanReport: (): ScanReport | null => {
      const report = value('last_scan_report');
      return report === null ? null : parseScanReport(report);
    },
    setLastScanReport: (report: ScanReport): void => {
      upsert.run('last_scan_report', JSON.stringify(report));
    },
  };
}
