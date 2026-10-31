/* Copies a lyrics library file's answers into this library, by the hash of the audio, so it works on any copy of the music. */

import { Worker } from 'node:worker_threads';
import Database from 'better-sqlite3';
import type { LyricsImportReport } from '@shared/domain';
import { err, errorText, ok, type Result } from '@shared/result';
import { connect, isCorruptionCode, sqliteCode, type Connection } from '@main/db/connection';

export type ImportJob = {
  sourcePath: string;
  dbPath: string;
};

type SourceRow = {
  audioHash: string;
  status: 'found' | 'instrumental';
  syncedLrc: string | null;
  plainText: string | null;
  fetchedAt: number;
};

const BATCH_ROWS = 200;
const NEEDED_COLUMNS = ['audio_hash', 'status', 'synced_lrc', 'plain_text', 'fetched_at'];
const NOT_A_LYRICS_LIBRARY = "That file isn't a lyrics library";

function isLyricsLibrary(source: Connection): boolean {
  const columns = source.pragma('table_info(lyrics)') as { name: string }[];
  const names = new Set(columns.map(({ name }) => name));
  return NEEDED_COLUMNS.every((column) => names.has(column));
}

function copyRows(source: Connection, target: Connection): LyricsImportReport {
  const report: LyricsImportReport = {
    rows: 0,
    matched: 0,
    added: 0,
    kept: 0,
    leftBehind:
      source.prepare<[], { n: number }>("SELECT count(*) AS n FROM lyrics WHERE status = 'not_found'").get()?.n ?? 0,
  };
  const rows = source.prepare<[], SourceRow>(`
    SELECT audio_hash AS audioHash, status, synced_lrc AS syncedLrc, plain_text AS plainText, fetched_at AS fetchedAt
    FROM lyrics
    WHERE status = 'instrumental' OR (status = 'found' AND (synced_lrc IS NOT NULL OR plain_text IS NOT NULL))
  `);
  // Whole files only: lyrics timed for a file are wrong for one track of a CUE album.
  const tracks = target.prepare<[string], { id: number }>(`
    SELECT t.id FROM tracks t JOIN files f ON f.id = t.file_id
    WHERE f.audio_hash = ? AND t.start_ms = 0 AND t.end_ms IS NULL
  `);
  // Anything LRCLIB has already said stays, except that it had nothing.
  const add = target.prepare<[number, string, string | null, string | null, number]>(`
    INSERT INTO lyrics (track_id, status, synced_lrc, plain_text, fetched_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (track_id) DO UPDATE SET
      status = excluded.status,
      synced_lrc = excluded.synced_lrc,
      plain_text = excluded.plain_text,
      fetched_at = excluded.fetched_at
    WHERE lyrics.status = 'not_found'
  `);

  const writeBatch = target.transaction((batch: SourceRow[]) => {
    for (const { audioHash, status, syncedLrc, plainText, fetchedAt } of batch) {
      for (const { id } of tracks.all(audioHash)) {
        report.matched += 1;
        if (add.run(id, status, syncedLrc, plainText, fetchedAt).changes > 0) report.added += 1;
        else report.kept += 1;
      }
    }
  });

  let batch: SourceRow[] = [];
  for (const row of rows.iterate()) {
    report.rows += 1;
    batch.push(row);
    if (batch.length === BATCH_ROWS) {
      writeBatch(batch);
      batch = [];
    }
  }
  writeBatch(batch);
  return report;
}

/** Slow enough to want a worker, and synchronous there. Small transactions, so main never waits long on the lock. */
export function runLyricsImport({ sourcePath, dbPath }: ImportJob): Result<LyricsImportReport> {
  let source: Connection;
  try {
    source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  } catch {
    return err('file_unreadable', "That file couldn't be opened");
  }
  const target = connect(dbPath);
  try {
    return isLyricsLibrary(source) ? ok(copyRows(source, target)) : err('file_unreadable', NOT_A_LYRICS_LIBRARY);
  } catch (error) {
    // Only the source is opened from a path someone just chose, and a damaged library shows up everywhere else as well.
    if (isCorruptionCode(sqliteCode(error))) return err('file_unreadable', NOT_A_LYRICS_LIBRARY);
    return err('unexpected', errorText(error));
  } finally {
    source.close();
    target.close();
  }
}

export function importInWorker(workerPath: string) {
  return (job: ImportJob): Promise<Result<LyricsImportReport>> =>
    new Promise((resolve) => {
      const worker = new Worker(workerPath, { workerData: job });
      worker.once('message', (result: Result<LyricsImportReport>) => {
        resolve(result);
        void worker.terminate();
      });
      worker.once('error', (error: unknown) => resolve(err('unexpected', errorText(error))));
      // Gone without a word, or the import would stay in progress for good.
      worker.once('exit', () => resolve(err('unexpected', 'The import stopped before it finished')));
    });
}
