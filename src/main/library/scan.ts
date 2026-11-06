import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { parseFile, selectCover, type IPicture } from 'music-metadata';
import type { ScanIssue, ScanPhase, ScanReport } from '@shared/domain';
import { errorText } from '@shared/result';
import { isRowProblem, type Connection } from '@main/db/connection';
import { audioHash } from '@main/library/audioHash';
import { planSheets } from '@main/library/cueScan';
import { fitsFile, type CueSplit } from '@main/library/cueSheet';
import { factsFrom } from '@main/library/fileFacts';
import { folderImageFor, mimeOfImagePath } from '@main/library/folderImage';
import { id3v2Genres } from '@main/library/id3Genre';
import { decodeText } from '@main/system/decodeText';
import {
  canAnythingHaveMoved,
  isUnder,
  matchMoved,
  planRescan,
  type FoundFile,
  type HashedFile,
  type KnownFile,
  type MatchedFile,
  type Move,
} from '@main/library/reconcile';
import { byRelPath, caseKey, folderOf, nameOf, toAbsolute } from '@main/library/relPath';
import {
  createScanWriter,
  type ArtRef,
  type FileHash,
  type FolderArtChange,
  type ReadFile,
} from '@main/library/scanWriter';
import { hasAudioStream, normalizeFormat, normalizeTags } from '@main/library/tags';
import { walkLibrary, type WalkResult } from '@main/library/walk';

const BATCH_FILES = 100;
const PROGRESS_INTERVAL_MS = 200;

export type ScanProgress = {
  phase: ScanPhase;
  filesFound: number;
  filesDone: number;
  currentPath: string | null;
};

export type ScanDeps = {
  root: string;
  db: Connection;
  hostname: string;
  now: () => number;
  isCancelled: () => boolean;
  onProgress: (progress: ScanProgress) => void;
  /** After every committed batch: there's something new for the list to show. */
  onCommit: () => void;
};

export type ScanOutcome =
  | { kind: 'finished'; report: ScanReport }
  | { kind: 'cancelled'; report: ScanReport }
  | { kind: 'root-unreadable'; message: string };

type ReadItem = {
  id: number | null;
  found: FoundFile;
  /** Set when the file was already hashed to look for moves. Otherwise it's done after reading. */
  hash: string | null;
};

type ReadOutcome = { kind: 'read'; file: ReadFile; issue: ScanIssue | null } | { kind: 'failed'; issue: ScanIssue };

/** `unreadable` isn't the same as no image: it may only be locked for a moment, and it says nothing about the art. */
type FolderArt = ArtRef | null | 'unreadable';

function createProgress(onProgress: ScanDeps['onProgress'], now: ScanDeps['now']) {
  let lastPosted = Number.NEGATIVE_INFINITY;
  const state: ScanProgress = { phase: 'walking', filesFound: 0, filesDone: 0, currentPath: null };

  function post(): void {
    lastPosted = now();
    onProgress({ ...state });
  }

  return {
    phase(phase: ScanPhase): void {
      state.phase = phase;
      post();
    },
    update(patch: Partial<ScanProgress>): void {
      Object.assign(state, patch);
      if (now() - lastPosted >= PROGRESS_INTERVAL_MS) post();
    },
    filesDone: () => state.filesDone,
  };
}

function artHashOf(bytes: Uint8Array): string {
  return createHash('sha1').update(bytes).digest('hex');
}

function sniffMime(bytes: Uint8Array, declared: string): string {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif';
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp';
  if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return declared.startsWith('image/') ? declared : 'application/octet-stream';
}

function embeddedArt(picture: IPicture | null, relPath: string): ArtRef | null {
  if (picture === null || picture.data.length === 0) return null;
  return {
    hash: artHashOf(picture.data),
    kind: 'embedded',
    relPath,
    mime: sniffMime(picture.data, picture.format),
  };
}

function isGone(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR');
}

/** A folder holds one image however many tracks ask about it, so each is read once per scan. */
function createFolderArt(
  root: string,
  images: WalkResult['images'],
  onUnreadable: (relPath: string, why: string) => void,
) {
  const known = new Map<string, FolderArt>();

  return async (audioRelPath: string): Promise<FolderArt> => {
    const relPath = folderImageFor(audioRelPath, images);
    if (relPath === null) return null;

    const cached = known.get(relPath);
    if (cached !== undefined) return cached;

    let art: FolderArt = null;
    try {
      const bytes = await readFile(toAbsolute(root, relPath));
      if (bytes.length > 0) {
        art = { hash: artHashOf(bytes), kind: 'folder', relPath, mime: mimeOfImagePath(relPath) };
      }
    } catch (error) {
      if (!isGone(error)) {
        art = 'unreadable';
        onUnreadable(relPath, errorText(error));
      }
    }
    known.set(relPath, art);
    return art;
  };
}

function issue(relPath: string, kind: ScanIssue['kind'], message: string): ScanIssue {
  return { relPath, kind, message };
}

export async function runScan({
  root,
  db,
  hostname,
  now,
  isCancelled,
  onProgress,
  onCommit,
}: ScanDeps): Promise<ScanOutcome> {
  const startedAt = now();
  const progress = createProgress(onProgress, now);
  const tally = { added: 0, updated: 0, moved: 0, restored: 0, nowMissing: 0, unchanged: 0 };
  const issues: ScanIssue[] = [];

  const report = ({ cancelled, looksEmpty }: { cancelled: boolean; looksEmpty: boolean }): ScanReport => ({
    finishedAt: now(),
    durationMs: now() - startedAt,
    cancelled,
    looksEmpty,
    ...tally,
    issues: issues.length,
  });
  const cancelledOutcome = (): ScanOutcome => ({
    kind: 'cancelled',
    report: report({ cancelled: true, looksEmpty: false }),
  });

  progress.phase('walking');
  const walk = await walkLibrary(root, {
    isCancelled,
    onFound: (filesFound, folder) => progress.update({ filesFound, currentPath: folder === '' ? null : folder }),
  });
  if (walk.rootError !== null) return { kind: 'root-unreadable', message: walk.rootError };
  if (walk.cancelled) return cancelledOutcome();

  for (const { relPath, message } of walk.unreadable) issues.push(issue(relPath, 'unreadable', message));

  const writer = createScanWriter(db, { now, hostname });
  const previousBadTags = writer.badTagIssues();
  const plan = planRescan(
    writer.knownFiles(),
    walk.files,
    walk.unreadable.map(({ relPath }) => relPath),
  );
  tally.unchanged = plan.unchanged.length;
  tally.restored = plan.restored.length;

  progress.update({ filesFound: walk.files.length, filesDone: plan.unchanged.length + plan.restored.length });
  progress.phase('reading');

  const hashes = new Map<string, string | null>();
  const hashed = async (file: FoundFile): Promise<HashedFile> => {
    progress.update({ currentPath: file.relPath });
    const hash = await audioHash(toAbsolute(root, file.relPath), isCancelled);
    hashes.set(file.relPath, hash);
    return { ...file, audioHash: hash };
  };

  // Only worth the reads when a row that lost its audio could be the source of a file with none.
  let added: FoundFile[] = plan.added;
  let changed = plan.changed;
  let gone = plan.gone;
  let moves: Move[] = [];
  let displaced: KnownFile[] = [];
  if (canAnythingHaveMoved(plan)) {
    const hashedAdded: HashedFile[] = [];
    for (const file of plan.added) {
      if (isCancelled()) return cancelledOutcome();
      hashedAdded.push(await hashed(file));
    }
    const hashedChanged: Move[] = [];
    for (const { known, found } of plan.changed) {
      if (isCancelled()) return cancelledOutcome();
      hashedChanged.push({ known, found: await hashed(found) });
    }
    if (isCancelled()) return cancelledOutcome();
    ({ added, changed, gone, moves, displaced } = matchMoved(plan.gone, hashedAdded, hashedChanged));
  }

  const renamed = [...plan.unchanged, ...plan.restored].filter(({ known, found }) => known.relPath !== found.relPath);
  writer.applyIdentity(plan.restored, renamed, moves, displaced);
  tally.moved = moves.length;

  const touchedFolders = new Set(
    [
      ...changed.map(({ found }) => found.relPath),
      ...moves.flatMap(({ known, found }) => [known.relPath, found.relPath]),
      ...added.map(({ relPath }) => relPath),
      ...gone.filter(({ missingSince }) => missingSince === null).map(({ relPath }) => relPath),
      ...plan.restored.map(({ found }) => found.relPath),
    ].map((relPath) => caseKey(folderOf(relPath))),
  );
  const sheets = await planSheets({
    known: writer.knownSheets(),
    found: walk.sheets,
    audio: walk.files,
    touchedFolders,
    unseen: new Set(walk.unreadable.map(({ relPath }) => caseKey(relPath))),
    looksEmpty: plan.looksEmpty,
    readSheet: (relPath) => readFile(toAbsolute(root, relPath)),
    decode: decodeText,
  });
  issues.push(...sheets.issues);

  // A file whose sheet came, went or changed is read again for its tags, which the tracks start from. Nothing else is.
  const reread = ({ known, found }: MatchedFile) =>
    sheets.released.has(known.id) || sheets.splits.has(caseKey(found.relPath));
  const rereadUnchanged = plan.unchanged.filter(reread);
  const rereadRestored = plan.restored.filter(reread);
  tally.unchanged -= rereadUnchanged.length;
  tally.restored -= rereadRestored.length;
  progress.update({ filesDone: progress.filesDone() - rereadUnchanged.length - rereadRestored.length });

  const hashOf = ({ relPath }: FoundFile) => hashes.get(relPath) ?? null;
  const work: ReadItem[] = [
    ...changed.map(({ known, found }) => ({ id: known.id, found, hash: hashOf(found) })),
    ...moves.map(({ known, found }) => ({ id: known.id, found, hash: found.audioHash })),
    ...added.map((found) => ({ id: null, found, hash: hashOf(found) })),
    ...[...rereadUnchanged, ...rereadRestored].map(({ known, found }) => ({
      id: known.id,
      found,
      hash: known.audioHash,
    })),
  ].toSorted((a, b) => byRelPath(a.found, b.found));

  const folderArt = createFolderArt(root, walk.images, (relPath, why) => {
    issues.push(issue(relPath, 'unreadable', `This image couldn't be read, so what it's for kept its art. ${why}`));
  });
  const movedIds = new Set(moves.map(({ known }) => known.id));
  const wasMissing = new Set(
    [...changed, ...rereadRestored].filter(({ known }) => known.missingSince !== null).map(({ known }) => known.id),
  );

  /** A sheet that goes beyond the end of its file is as good as malformed, and only reading the file can say so. */
  function usableSplit(relPath: string, durationMs: number): CueSplit | null {
    const found = sheets.splits.get(caseKey(relPath));
    if (found === undefined) return null;
    if (fitsFile(found.split, durationMs)) return found.split;
    const result = sheets.results.get(found.sheet);
    if (result !== undefined) {
      const message = `It has tracks past the end of ${nameOf(relPath)}`;
      sheets.results.set(found.sheet, { ...result, target: null, issue: issue(found.sheet, 'bad_cue', message) });
    }
    return null;
  }

  async function read({ id, found, hash }: ReadItem): Promise<ReadOutcome> {
    const { relPath } = found;
    // Not saved, so the sheet gets another look along with the file next time.
    const failed = (reason: ScanIssue): ReadOutcome => {
      const sheet = sheets.splits.get(caseKey(relPath))?.sheet;
      if (sheet !== undefined) sheets.results.delete(sheet);
      return { kind: 'failed', issue: reason };
    };
    if (found.sizeBytes === 0) return failed(issue(relPath, 'no_audio', 'The file is empty'));

    const path = toAbsolute(root, relPath);
    try {
      const metadata = await parseFile(path, { duration: true });
      if (!hasAudioStream(metadata.format)) return failed(issue(relPath, 'no_audio', 'No audio stream found'));

      const tags = normalizeTags(metadata, relPath, await id3v2Genres(path, metadata.native));
      const picture = embeddedArt(selectCover(metadata.common.picture), relPath);
      const beside = picture === null ? await folderArt(relPath) : null;
      const format = normalizeFormat(metadata.format, relPath);
      const cue = usableSplit(relPath, format.durationMs);
      const file: ReadFile = {
        id,
        found,
        tags,
        format,
        facts: await factsFrom(metadata, path),
        art: beside === 'unreadable' ? null : (picture ?? beside),
        keepArt: beside === 'unreadable',
        audioHash: hash,
        cue,
      };
      const badTags =
        tags.titleIsFileName && cue === null
          ? issue(relPath, 'bad_tags', 'No title tag, so the file name is used')
          : null;
      return { kind: 'read', file, issue: badTags };
    } catch (error) {
      return failed(issue(relPath, 'unreadable', errorText(error)));
    }
  }

  function countSaved({ id }: ReadFile): void {
    if (id === null) tally.added++;
    else if (wasMissing.has(id)) tally.restored++;
    else if (!movedIds.has(id)) tally.updated++;
  }

  /** A row the database refuses is one bad file, so the rest of its batch goes in without it. */
  function saveOneAtATime(files: ReadFile[]): void {
    for (const file of files) {
      try {
        writer.commit([file]);
        countSaved(file);
      } catch (error) {
        if (!isRowProblem(error)) throw error;
        issues.push(issue(file.found.relPath, 'unreadable', `This file couldn't be saved. ${errorText(error)}`));
      }
    }
  }

  let batch: ReadFile[] = [];
  const commitBatch = (): void => {
    if (batch.length === 0) return;
    const files = batch;
    batch = [];
    try {
      writer.commit(files);
      for (const file of files) countSaved(file);
    } catch (error) {
      if (!isRowProblem(error)) throw error;
      saveOneAtATime(files);
    }
    onCommit();
  };

  for (const item of work) {
    if (isCancelled()) {
      commitBatch();
      return cancelledOutcome();
    }
    progress.update({ currentPath: item.found.relPath });

    const outcome = await read(item);
    if (outcome.issue) issues.push(outcome.issue);
    if (outcome.kind === 'read') {
      batch.push(outcome.file);
      if (batch.length >= BATCH_FILES) commitBatch();
    }
    progress.update({ filesDone: progress.filesDone() + 1 });
  }
  commitBatch();

  // Only now, so a scan cut short reads these sheets and their files again.
  const sheetResults = [...sheets.results.values()];
  for (const { issue: said } of sheetResults) if (said !== null) issues.push(said);
  writer.saveSheets(sheetResults, sheets.removed);

  // Hashing can read the whole file, so it waits until the list is full. A file stays NULL until it's
  // done, which is how a later scan knows to carry on. Nothing is gone yet at this point: that's the last step.
  const unhashed = writer.filesWithoutHash();
  progress.update({ filesFound: unhashed.length, filesDone: 0, currentPath: null });
  progress.phase('hashing');
  let done: FileHash[] = [];
  for (const [index, { id, relPath }] of unhashed.entries()) {
    if (isCancelled()) break;
    progress.update({ currentPath: relPath, filesDone: index });
    const hash = await audioHash(toAbsolute(root, relPath), isCancelled);
    if (hash !== null) done.push({ id, hash });
    if (done.length >= BATCH_FILES) {
      writer.saveHashes(done);
      done = [];
    }
  }
  writer.saveHashes(done);
  if (isCancelled()) return cancelledOutcome();

  progress.update({ filesDone: unhashed.length, currentPath: null });
  progress.phase('writing');

  // A folder image can appear, change or go away without any audio file changing. A folder the walk
  // didn't see into says nothing about that, and neither does a library that looks empty.
  const folderArtChanges: FolderArtChange[] = [];
  const stillSources = new Map<string, ArtRef>();
  const unseen = new Set(walk.unreadable.map(({ relPath }) => caseKey(relPath)));
  for (const { id, relPath, artHash } of plan.looksEmpty ? [] : writer.filesWithFolderArt()) {
    if (isUnder(caseKey(relPath), unseen)) continue;
    const art = await folderArt(relPath);
    if (art === 'unreadable') continue;
    if ((art?.hash ?? null) !== artHash) folderArtChanges.push({ fileId: id, art });
    else if (art !== null) stillSources.set(art.hash, art);
  }

  // Every image looking gone at once is more likely the drive going than the images.
  if (folderArtChanges.some(({ art }) => art === null)) {
    try {
      await readdir(root);
    } catch (error) {
      return { kind: 'root-unreadable', message: errorText(error) };
    }
  }

  // Files that weren't read this time keep what's known about them, because nothing else would bring it back.
  const settled = new Set(
    [
      ...work.map(({ found }) => found.relPath),
      ...moves.map(({ known }) => known.relPath),
      ...gone.map(({ relPath }) => relPath),
    ].map(caseKey),
  );
  issues.push(...previousBadTags.filter(({ relPath }) => !settled.has(caseKey(relPath))));

  tally.nowMissing = gone.filter(({ missingSince }) => missingSince === null).length;

  const somethingChanged =
    tally.added + tally.updated + tally.moved + tally.restored + tally.nowMissing + renamed.length > 0 ||
    folderArtChanges.length > 0;
  writer.finish({
    missing: gone,
    folderArt: folderArtChanges,
    artSources: [...stillSources.values()],
    issues,
    somethingChanged,
  });
  if (somethingChanged) db.pragma('optimize');

  return { kind: 'finished', report: report({ cancelled: false, looksEmpty: plan.looksEmpty }) };
}
