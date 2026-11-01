/* What runs in the report's worker: all of it reads the database or reads files, and only the facts it read get written. */

import type { Track } from '@shared/domain';
import { connect, type Connection } from '@main/db/connection';
import { readFileFacts, type FileFacts } from '@main/library/fileFacts';
import { createQueries } from '@main/library/queries';
import { toAbsolute } from '@main/library/relPath';
import { checkById, createReportQueries, type StoredReport } from './checks';

const BATCH_FILES = 100;

export type ReportJob =
  | { kind: 'report'; dbPath: string }
  | { kind: 'tracks'; dbPath: string; checkId: string }
  | { kind: 'file-facts'; dbPath: string; root: string };

export type ReportAnswers = {
  report: StoredReport;
  tracks: Track[];
  /** How many files are left unread, because they couldn't be. */
  'file-facts': number;
};

/** Fills in what a scan from before these columns never kept, without a rescan. Leaves its own file's row out on a failure. */
export async function fillFileFacts(db: Connection, root: string): Promise<number> {
  const unread = db
    .prepare<[], { id: number; relPath: string }>(
      `SELECT id, rel_path AS relPath FROM files WHERE missing_since IS NULL AND has_replaygain IS NULL ORDER BY rel_path`,
    )
    .all();
  const update = db.prepare<[{ id: number; replayGain: number; albumArtist: number; gapless: number | null }]>(
    `UPDATE files SET has_replaygain = @replayGain, has_album_artist = @albumArtist, has_gapless_header = @gapless
     WHERE id = @id`,
  );
  const save = db.transaction((rows: { id: number; facts: FileFacts }[]) => {
    for (const { id, facts } of rows) {
      update.run({
        id,
        replayGain: Number(facts.hasReplayGain),
        albumArtist: Number(facts.hasAlbumArtist),
        gapless: facts.hasGaplessHeader === null ? null : Number(facts.hasGaplessHeader),
      });
    }
  });

  let batch: { id: number; facts: FileFacts }[] = [];
  let failed = 0;
  for (const { id, relPath } of unread) {
    try {
      batch.push({ id, facts: await readFileFacts(toAbsolute(root, relPath)) });
    } catch {
      failed += 1;
    }
    if (batch.length >= BATCH_FILES) {
      save.immediate(batch);
      batch = [];
    }
  }
  if (batch.length > 0) save.immediate(batch);
  return failed;
}

export async function runReportJob(job: ReportJob): Promise<ReportAnswers[ReportJob['kind']]> {
  const db = connect(job.dbPath);
  try {
    switch (job.kind) {
      case 'report':
        return createReportQueries(db).stored();
      case 'tracks': {
        const check = checkById(job.checkId);
        return check === null ? [] : createQueries(db).tracksByIds(createReportQueries(db).trackIds(check));
      }
      case 'file-facts':
        return await fillFileFacts(db, job.root);
    }
  } finally {
    db.close();
  }
}
