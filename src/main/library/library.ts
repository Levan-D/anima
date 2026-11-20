/*
 * The Library: the status state machine, the open connection, and the only way anything else
 * reaches the database. It's told about the outside world through its deps, so it runs on plain Node
 * in the tests.
 */
import { statSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type {
  ChangeScope,
  DbProblem,
  LibraryStatus,
  Notice,
  ScanReport,
  ScanState,
  StorageInfo,
  Track,
} from '@shared/domain';
import type { EventPayload } from '@shared/ipc/contract';
import type { EventName } from '@shared/ipc/channels';
import { err, errorText, ok, type Result } from '@shared/result';
import { putBackupInPlace, setAside, type BackupFinder } from '@main/db/backups';
import {
  isCorruption,
  isDiskFailure,
  isLocked,
  sqliteCode,
  whyNotWritable,
  type Connection,
} from '@main/db/connection';
import type { MaintenanceRunner, RunningMaintenance } from '@main/db/maintenance';
import { closeCleanly, openDatabase } from '@main/db/open';
import type { ArtCache, ArtCatalog } from '@main/library/artCache';
import type { ArtJob } from '@main/library/artQueue';
import { libraryPaths, writeProblem, type LibraryPaths } from '@main/library/dataDir';
import { folderImageCandidates } from '@main/library/folderImage';
import {
  createLibraryWrites,
  createQueries,
  type LibraryQueries,
  type LibraryWrites,
  type PlayableTrack,
} from '@main/library/queries';
import { toAbsolute } from '@main/library/relPath';
import { createScanner, type ScanRunner } from '@main/library/scanner';

const OTHER_ART_SOURCES = 5;
const ART_PASS_DELAY_MS = 2_000;
const COLORS_CHANGED_INTERVAL_MS = 1_500;

const PROBLEM_WORDS: Record<DbProblem, string> = {
  damaged: 'The file is damaged, so it was left as it is.',
  'not-ours': "That file isn't an anima database, so it was left alone.",
  lost: 'The file is empty or gone, which an interrupted copy of the folder can do.',
  'migration-failed': "It couldn't be updated for this version, so it was left as it was.",
};
const DAMAGED = "The library's database is damaged";
const NOT_OPEN = "The library isn't open";

export type LibraryDeps = {
  settings: {
    get(): { libraryFolder: string | null };
    update(patch: { libraryFolder: string }): unknown;
  };
  emit: <E extends EventName>(event: E, payload: EventPayload<E>) => void;
  notify: (level: Notice['level'], message: string, action: Notice['action']) => void;
  log: {
    info: (...details: unknown[]) => void;
    warn: (...details: unknown[]) => void;
    error: (...details: unknown[]) => void;
  };
  /** Opens the folder dialog. Null when cancelled. */
  pickFolder: (defaultPath: string | null) => Promise<string | null>;
  /** Null in a packaged app: the database then lives in the music folder, as designed. */
  devDataRoot: string | null;
  hostname: string;
  now: () => number;
  art: ArtCache;
  runScan: ScanRunner;
  runMaintenance: MaintenanceRunner;
  /** The newest backup that opens and passes a full check. Off this thread, since that takes seconds. */
  findBackup: BackupFinder;
  artPassDelayMs?: number;
};

type Session = LibraryPaths & {
  folder: string;
  db: Connection;
  queries: LibraryQueries;
  writes: LibraryWrites;
  maintenance: RunningMaintenance | null;
};

type StoredInfo = Pick<
  StorageInfo,
  'libraryFolder' | 'databasePath' | 'databaseBytes' | 'counts' | 'lastScanAt' | 'lastChanged'
>;

export type Library = ReturnType<typeof createLibrary>;

function isFolder(path: string): boolean {
  try {
    return statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;
  } catch {
    return false;
  }
}

/** Only a definite no: a denied or unreadable path isn't proof the file is gone. */
async function isAbsent(path: string): Promise<boolean> {
  try {
    await stat(path);
    return false;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR';
  }
}

export function createLibrary(deps: LibraryDeps) {
  const { settings, emit, notify, log, art, now, hostname } = deps;

  let status: LibraryStatus = { state: 'no-folder' };
  let session: Session | null = null;
  let emittedStatus = '';
  let isPicking = false;
  let artPassTimer: ReturnType<typeof setTimeout> | null = null;
  let colorsTimer: ReturnType<typeof setTimeout> | null = null;
  const statusListeners = new Set<(status: LibraryStatus) => void>();
  const scanListeners = new Set<(state: ScanState) => void>();
  // Opening and closing can't overlap, whichever window asked and however slow the disk is.
  let lastOperation: Promise<unknown> = Promise.resolve();

  function inOrder<T>(operation: () => T | Promise<T>): Promise<T> {
    const run = lastOperation.then(operation, operation);
    lastOperation = run.catch(() => {});
    return run;
  }

  function setStatus(next: LibraryStatus): void {
    status = next;
    const serialized = JSON.stringify(next);
    if (serialized === emittedStatus) return;
    emittedStatus = serialized;
    emit('library.status', next);
    for (const listener of statusListeners) listener(next);
  }

  function readyStatus({ folder, queries }: Session): Extract<LibraryStatus, { state: 'ready' }> {
    const lastChanged = queries.lastChanged();
    return {
      state: 'ready',
      folder,
      isEmpty: queries.isEmpty(),
      lastChanged,
      changedElsewhere: lastChanged !== null && lastChanged.host !== hostname,
    };
  }

  function refreshStatus(): void {
    const current = session;
    if (!current) return;
    const next = read(() => readyStatus(current));
    if (next.ok) setStatus(next.value);
  }

  let backupLookups = 0;

  /** Says so at once, and which backup could replace it once the backups have been checked. */
  function corruptStatus(folder: string, backupsDir: string, cause: DbProblem): LibraryStatus {
    const lookup = ++backupLookups;
    void deps
      .findBackup(backupsDir)
      .catch(() => null)
      .then((backup) => {
        if (lookup !== backupLookups || status.state !== 'db-corrupt' || status.folder !== folder) return;
        setStatus({ ...status, backupAt: backupTime(backup), isLookingForBackup: false });
      });
    return {
      state: 'db-corrupt',
      folder,
      cause,
      backupAt: null,
      isLookingForBackup: true,
      message: PROBLEM_WORDS[cause],
    };
  }

  function backupTime(backup: string | null): number | null {
    if (backup === null) return null;
    try {
      return statSync(backup).mtimeMs;
    } catch {
      return null;
    }
  }

  /** The one place a damaged database or a vanished disk becomes a status. */
  function guarded<T>(work: (current: Session) => T): Result<T> {
    if (!session || status.state !== 'ready') {
      return err(status.state === 'db-corrupt' ? 'db_corrupt' : 'no_library', NOT_OPEN);
    }
    try {
      return ok(work(session));
    } catch (error) {
      if (isCorruption(error)) {
        log.error('The database is corrupt', error);
        markCorrupt(errorText(error));
        return err('db_corrupt', DAMAGED);
      }
      if (isDiskFailure(error)) {
        log.error('The database stopped responding', error);
        void reevaluate();
        return err('library_folder_missing', "The library folder can't be reached right now");
      }
      throw error;
    }
  }

  function read<T>(work: (queries: LibraryQueries) => T): Result<T> {
    return guarded(({ queries }) => work(queries));
  }

  function write<T>(work: (writes: LibraryWrites) => T): Result<T> {
    return guarded(({ writes }) => work(writes));
  }

  function markCorrupt(detail: string): void {
    const current = session;
    if (!current || status.state !== 'ready') return;
    log.error('The database is damaged', detail);
    setStatus(corruptStatus(current.folder, current.backupsDir, 'damaged'));
    void inOrder(closeSession);
  }

  function catalogOf({ folder }: Session): ArtCatalog {
    const artRow = (hash: string) => {
      const row = read((queries) => queries.artRow(hash));
      return row.ok ? row.value : null;
    };
    return {
      mimeOf: (hash) => artRow(hash)?.mime ?? null,
      jobFor(hash) {
        const row = artRow(hash);
        const others = read((queries) => queries.otherFilesWithArt(hash, OTHER_ART_SOURCES));
        if (row === null || !others.ok) return null;
        // The row's own source can be stale until the next scan, so each file that uses the image is asked as well.
        return {
          hash,
          mime: row.mime,
          sources: [
            { kind: row.sourceKind, path: toAbsolute(folder, row.sourceRelPath) },
            ...others.value.flatMap(({ relPath, artSource }): ArtJob['sources'] =>
              artSource === 'embedded'
                ? [{ kind: 'embedded', path: toAbsolute(folder, relPath) }]
                : folderImageCandidates(relPath).map((image) => ({ kind: 'folder', path: toAbsolute(folder, image) })),
            ),
          ],
        };
      },
      rows() {
        const rows = read((queries) => queries.artRows());
        return rows.ok ? rows.value : null;
      },
      saveColor(hash, color) {
        write((writes) => writes.setArtColor(hash, color));
        announceColors();
      },
      unmeasured() {
        const rows = read((queries) => queries.unmeasuredArt());
        return rows.ok ? rows.value : [];
      },
      saveSizes(sizes) {
        write((writes) => writes.setArtSizes(sizes));
        emit('library.changed', { scopes: ['report'] });
      },
    };
  }

  /** A color can arrive long after the lists were read, and the accent wants it. */
  function announceColors(): void {
    colorsTimer ??= setTimeout(() => {
      colorsTimer = null;
      emit('library.changed', { scopes: ['library'] });
    }, COLORS_CHANGED_INTERVAL_MS);
  }

  function startMaintenance(opened: Session): void {
    opened.maintenance = deps.runMaintenance(
      { dbPath: opened.dbPath, backupsDir: opened.backupsDir, now: now() },
      (event) => {
        if (event.type === 'check' && event.problem !== null && session === opened) markCorrupt(event.problem);
        else if (event.type === 'failed') log.warn('Database maintenance failed', event.message);
        else if (event.type === 'backup') log.info('Backed up the database to', event.path);
      },
    );
  }

  function scheduleArtPass(): void {
    if (artPassTimer !== null) clearTimeout(artPassTimer);
    artPassTimer = setTimeout(() => {
      artPassTimer = null;
      if (scanner.isRunning()) return;
      art.runBackgroundPass().catch((error: unknown) => log.warn('The art pass failed', error));
    }, deps.artPassDelayMs ?? ART_PASS_DELAY_MS);
  }

  /** No folder, folder gone, can't write, then the database itself. Nothing here throws for an expected problem. */
  function open({ startFresh = false }: { startFresh?: boolean } = {}): void {
    const folder = settings.get().libraryFolder;
    if (folder === null) {
      setStatus({ state: 'no-folder' });
      return;
    }
    if (!isFolder(folder)) {
      setStatus({ state: 'folder-missing', folder });
      return;
    }

    const paths = libraryPaths(folder, deps.devDataRoot);
    const problem = writeProblem(paths.dataDir);
    if (problem !== null) {
      log.warn('Could not write to the data folder', paths.dataDir, problem);
      setStatus({ state: 'not-writable', folder, message: whyNotWritable(problem) });
      return;
    }

    const outcome = openDatabase(paths.dbPath, { backupsDir: paths.backupsDir, now: now(), startFresh });
    switch (outcome.kind) {
      case 'too-new':
        setStatus({ state: 'db-too-new', folder });
        return;
      case 'unwritable':
        log.warn('Could not write to the database', paths.dbPath, outcome.detail);
        setStatus({ state: 'not-writable', folder, message: outcome.message });
        return;
      case 'corrupt':
      case 'migration-failed':
        log.error('Could not open the database', paths.dbPath, outcome.detail);
        setStatus(
          corruptStatus(folder, paths.backupsDir, outcome.kind === 'corrupt' ? outcome.cause : 'migration-failed'),
        );
        return;
      case 'open':
    }

    let opened: Session;
    let ready: ReturnType<typeof readyStatus>;
    let hasFinishedAScan: boolean;
    let lastReport: ScanReport | null;
    try {
      opened = {
        ...paths,
        folder,
        db: outcome.db,
        queries: createQueries(outcome.db),
        writes: createLibraryWrites(outcome.db),
        maintenance: null,
      };
      ready = readyStatus(opened);
      hasFinishedAScan = opened.queries.lastScanAt() !== null;
      lastReport = opened.queries.lastScanReport();
    } catch (error) {
      outcome.db.close();
      if (sqliteCode(error) === null) throw error;
      log.error('Could not read the database', paths.dbPath, error);
      if (isDiskFailure(error) || isLocked(error)) {
        setStatus({ state: 'not-writable', folder, message: whyNotWritable(error) });
      } else {
        setStatus(corruptStatus(folder, paths.backupsDir, 'damaged'));
      }
      return;
    }

    session = opened;
    scanner.rememberReport(lastReport);
    art.use(catalogOf(opened));
    startMaintenance(opened);
    // Before the status goes out, so a folder that's about to be scanned never shows as one with no music in it.
    // A first scan that was stopped carries on here, because a library that's half there looks finished.
    if (!hasFinishedAScan) scanner.start({ root: folder, dbPath: paths.dbPath, hostname });
    else if (!ready.isEmpty) scheduleArtPass();
    setStatus(ready);
  }

  async function closeSession(): Promise<void> {
    if (artPassTimer !== null) clearTimeout(artPassTimer);
    artPassTimer = null;
    if (colorsTimer !== null) clearTimeout(colorsTimer);
    colorsTimer = null;
    await scanner.stop();
    art.use(null);

    const closing = session;
    session = null;
    if (!closing) return;
    await closing.maintenance?.stop();
    try {
      closeCleanly(closing.db);
    } catch (error) {
      log.warn('Could not close the database cleanly', error);
    }
  }

  function reevaluate(): Promise<LibraryStatus> {
    return inOrder(async () => {
      await closeSession();
      open();
      return status;
    });
  }

  function startScan(): Result<void> {
    if (!session || status.state !== 'ready') return err('no_library', NOT_OPEN);
    return scanner.start({ root: session.folder, dbPath: session.dbPath, hostname });
  }

  const scanner = createScanner({
    run: deps.runScan,
    emitState: (state: ScanState) => {
      emit('scan.state', state);
      for (const listener of scanListeners) listener(state);
    },
    emitChanged: (scopes: ChangeScope[]) => emit('library.changed', { scopes }),
    notify,
    log,
    now,
    artPass: (onProgress) => art.runBackgroundPass(onProgress),
    stopArtPass: () => art.stopBackgroundPass(),
    pruneArt: () => art.prune(),
    onCommitted: refreshStatus,
    saveReport(report) {
      try {
        write((writes) => writes.setLastScanReport(report));
      } catch (error) {
        log.warn('Could not save the scan report', error);
      }
    },
    onRootUnreadable: (message) => {
      log.warn('The library folder could not be read', message);
      // A status change is its own full-screen answer. Only a folder that's somehow fine again needs saying.
      void reevaluate().then((next) => {
        if (next.state === 'ready') notify('error', "The library folder couldn't be read", null);
      });
    },
    onCorrupt: markCorrupt,
  });

  function markChanged(): void {
    write((writes) => writes.markChanged(now(), hostname));
    refreshStatus();
  }

  return {
    status: () => status,
    folder: () => settings.get().libraryFolder,
    read,

    /**
     * For a later module's own statements. `create` runs once per connection, and the connection changes when the
     * folder does, so the module never holds on to a closed one. What it gets back is guarded the same way as `read`.
     */
    perConnection<Q>(create: (db: Connection) => Q) {
      let made: { db: Connection; queries: Q } | null = null;
      return <T>(work: (queries: Q) => T): Result<T> =>
        guarded(({ db }) => {
          if (made?.db !== db) made = { db, queries: create(db) };
          return work(made.queries);
        });
    },

    /** For what has to react on main: ids mean nothing once a different database is open. Returns how to stop. */
    onStatus(listener: (status: LibraryStatus) => void): () => void {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },

    onScanState(listener: (state: ScanState) => void): () => void {
      scanListeners.add(listener);
      return () => scanListeners.delete(listener);
    },

    /** Runs the status flow. Synchronous, so the window opens knowing the answer. */
    open: () => open(),

    async chooseFolder(): Promise<LibraryStatus> {
      if (isPicking) return status;
      isPicking = true;
      try {
        const picked = await deps.pickFolder(settings.get().libraryFolder);
        if (picked === null) return status;

        const folder = resolve(picked);
        return await inOrder(async () => {
          if (folder === session?.folder) return status;
          await closeSession();
          scanner.forgetReport();
          settings.update({ libraryFolder: folder });
          open();
          const isEmpty = read((queries) => queries.isEmpty());
          if (isEmpty.ok && isEmpty.value) startScan();
          return status;
        });
      } finally {
        isPicking = false;
      }
    },

    retryOpen: (): Promise<LibraryStatus> => (status.state === 'ready' ? Promise.resolve(status) : reevaluate()),

    /** Sets the bad file aside, and copies the newest backup that opens and passes a check into its place. */
    restoreBackup(): Promise<Result<LibraryStatus>> {
      return inOrder(async () => {
        const folder = settings.get().libraryFolder;
        if (folder === null) return err('no_library', 'Pick a library folder first');

        const { dbPath, backupsDir } = libraryPaths(folder, deps.devDataRoot);
        const backup = await deps.findBackup(backupsDir).catch(() => null);
        if (backup === null) return err('no_backup', 'There is no usable backup to restore');

        await closeSession();
        try {
          putBackupInPlace(backup, dbPath, now());
        } catch (error) {
          log.error('Could not restore the backup', error);
          open();
          return err('library_not_writable', "The backup couldn't be put in place");
        }
        log.info('Restored the database from', backup);
        scanner.forgetReport();
        open();
        return ok(status);
      });
    },

    /** Sets the file aside, starts empty and scans. Playlists are lost from the new database, but the old file stays. */
    rebuild(): Promise<Result<LibraryStatus>> {
      return inOrder(async () => {
        const folder = settings.get().libraryFolder;
        if (folder === null) return err('no_library', 'Pick a library folder first');

        const { dbPath } = libraryPaths(folder, deps.devDataRoot);
        await closeSession();
        try {
          setAside(dbPath, now());
        } catch (error) {
          log.error('Could not set the database aside', error);
          open();
          return err('library_not_writable', "The database couldn't be set aside");
        }
        scanner.forgetReport();
        open({ startFresh: true });
        return ok(status);
      });
    },

    /** For a worker's own connection. Null with no library open. */
    databasePath: () => session?.dbPath ?? null,

    /** Stops the workers, checkpoints and closes, so the .db file is complete if the folder gets copied now. */
    close(): Promise<void> {
      return inOrder(async () => {
        await closeSession();
        await art.stop();
      });
    },

    startScan,
    cancelScan: () => scanner.cancel(),
    scanState: () => scanner.state(),

    /** Deliberate and destructive: playlist items go too. */
    removeMissing(): Result<{ removed: number }> {
      if (scanner.isRunning()) return err('scan_running', 'Wait for the scan to finish first');
      const removed = write((writes) => writes.removeMissing());
      if (!removed.ok) return removed;
      if (removed.value > 0) {
        markChanged();
        emit('library.changed', { scopes: ['library', 'playlists', 'stats', 'lyrics'] });
      }
      return ok({ removed: removed.value });
    },

    /** In the given order, missing tracks included. */
    tracksByIds: (ids: number[]): Result<Track[]> => read((queries) => queries.tracksByIds(ids)),

    /** The same, with where each one is in its file. */
    playableTracks: (ids: number[]): Result<PlayableTrack[]> => read((queries) => queries.playableTracks(ids)),

    /** Null when there's no library open, or no such track. The file may or may not be there. */
    absolutePath(trackId: number): string | null {
      const current = session;
      const found = read((queries) => queries.relPathOfTrack(trackId));
      if (!found.ok || found.value === null || !current) return null;
      return toAbsolute(current.folder, found.value);
    },

    /**
     * The track a playlist file means: the one at that path in this library, or else one with that title and artist,
     * for a file that has moved since. Null when neither is here.
     */
    findTrack(absPath: string, artist: string | null, title: string | null): number | null {
      const current = session;
      if (!current) return null;
      const rel = relative(current.folder, absPath);
      const isInside = rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
      const found = read(
        (queries) =>
          (isInside ? queries.trackAtRelPath(rel.split(sep).join('/')) : null) ??
          (title === null ? null : queries.trackByName(artist, title)),
      );
      return found.ok ? found.value : null;
    },

    /**
     * For a file mpv couldn't open. mpv says the same for a long path, a denied file or a drive that blinked, so it's
     * only marked missing when the file is absent and the folder it lives in isn't. A scan clears it if it comes back.
     */
    async markMissingIfGone(trackId: number): Promise<boolean> {
      const current = session;
      const found = read((queries) => queries.relPathOfTrack(trackId));
      if (!current || !found.ok || found.value === null) return false;
      const path = toAbsolute(current.folder, found.value);
      if (!(await isAbsent(path)) || (await isAbsent(current.folder))) return false;
      const marked = write((writes) => writes.markMissing(trackId, now()));
      if (!marked.ok || !marked.value) return marked.ok;
      markChanged();
      emit('library.changed', { scopes: ['library', 'playlists'] });
      return true;
    },

    /** For later phases: anything that writes to the database and should count as a change to the library. */
    markChanged,

    storedInfo(): StoredInfo {
      const current = session;
      const empty: StoredInfo = {
        libraryFolder: settings.get().libraryFolder,
        databasePath: null,
        databaseBytes: null,
        counts: { tracks: 0, albums: 0, artists: 0, missing: 0 },
        lastScanAt: null,
        lastChanged: null,
      };
      if (!current) return empty;

      const stored = read((queries) => ({
        counts: queries.counts(),
        lastScanAt: queries.lastScanAt(),
        lastChanged: queries.lastChanged(),
      }));
      const bytes = [current.dbPath, `${current.dbPath}-wal`].reduce(
        (sum, path) => sum + (statSync(path, { throwIfNoEntry: false })?.size ?? 0),
        0,
      );
      return {
        ...empty,
        databasePath: current.dbPath,
        databaseBytes: bytes,
        ...(stored.ok ? stored.value : {}),
      };
    },
  };
}
