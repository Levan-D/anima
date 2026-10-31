import { Worker } from 'node:worker_threads';
import type { ChangeScope, Notice, ScanReport, ScanState } from '@shared/domain';
import { err, errorText, ok, type Result } from '@shared/result';
import { isCorruptionCode } from '@main/db/connection';
import type { ScanOutcome, ScanProgress } from '@main/library/scan';

const CHANGED_INTERVAL_MS = 1_500;
const ART_PROGRESS_INTERVAL_MS = 200;
const CANCEL_GRACE_MS = 5_000;

export type ScanJob = {
  root: string;
  dbPath: string;
  hostname: string;
};

export type ScanEvent =
  | { type: 'progress'; progress: ScanProgress }
  | { type: 'committed' }
  | { type: 'done'; outcome: ScanOutcome }
  | { type: 'failed'; message: string; code: string | null };

type RunningScan = {
  cancel(): void;
  /** Ends it now. Whatever hadn't been committed is lost, and the next scan picks that up. */
  terminate(): Promise<void>;
};

export type ScanRunner = (job: ScanJob, onEvent: (event: ScanEvent) => void) => RunningScan;

export function scanInWorker(workerPath: string): ScanRunner {
  return (job, onEvent) => {
    let settled = false;
    const report = (event: ScanEvent) => {
      if (event.type === 'done' || event.type === 'failed') settled = true;
      onEvent(event);
    };

    const worker = new Worker(workerPath, { workerData: job });
    worker.on('message', (event: ScanEvent) => report(event));
    worker.on('error', (error: unknown) => {
      if (!settled) report({ type: 'failed', message: errorText(error), code: null });
    });
    worker.on('exit', () => {
      if (!settled) report({ type: 'failed', message: 'The scan worker exited early', code: null });
    });

    return {
      cancel: () => worker.postMessage('cancel'),
      terminate: async () => {
        settled = true;
        await worker.terminate();
      },
    };
  };
}

export type ScannerDeps = {
  run: ScanRunner;
  emitState: (state: ScanState) => void;
  emitChanged: (scopes: ChangeScope[]) => void;
  notify: (level: Notice['level'], message: string, action: Notice['action']) => void;
  log: { error: (...details: unknown[]) => void };
  now: () => number;
  /** Runs the art phase. Reports progress, and resolves when it's finished or was told to stop. */
  artPass: (onProgress: (done: number, total: number) => void) => Promise<void>;
  stopArtPass: () => void;
  pruneArt: () => Promise<void>;
  /** Something was committed: the status may have changed too. */
  onCommitted: () => void;
  /** Keeps the report with the database, so it's still there next time the library opens. */
  saveReport: (report: ScanReport) => void;
  onRootUnreadable: (message: string) => void;
  onCorrupt: (message: string) => void;
};

type Scanner = {
  state(): ScanState;
  isRunning(): boolean;
  start(job: ScanJob): Result<void>;
  cancel(): void;
  /** Cancels, waits for the current file, and forces the end if that takes too long. */
  stop(): Promise<void>;
  /** The report describes a library, so it goes when that library does. */
  forgetReport(): void;
  /** What the library that just opened says its last scan found. */
  rememberReport(report: ScanReport | null): void;
};

/** Null when there's nothing worth a toast: a folder with nothing in it already says so on the screen. */
export function summarize(report: ScanReport): string | null {
  const { cancelled, added, updated, moved, nowMissing, restored, unchanged, issues } = report;
  const parts = [
    added > 0 && `${added.toLocaleString('en')} added`,
    updated > 0 && `${updated.toLocaleString('en')} updated`,
    moved > 0 && `${moved.toLocaleString('en')} moved`,
    restored > 0 && `${restored.toLocaleString('en')} restored`,
    nowMissing > 0 && `${nowMissing.toLocaleString('en')} now missing`,
    issues > 0 && `${issues.toLocaleString('en')} with issues`,
  ].filter((part) => part !== false);
  if (cancelled) return parts.length > 0 ? `Scan cancelled: ${parts.join(', ')}` : 'Scan cancelled';
  if (parts.length > 0) return `Scan finished: ${parts.join(', ')}`;
  return unchanged > 0 ? 'Library is up to date' : null;
}

const IDLE: ScanState = { phase: 'idle', filesFound: 0, filesDone: 0, currentPath: null, lastReport: null };

export function createScanner(deps: ScannerDeps): Scanner {
  let state = IDLE;
  let running: RunningScan | null = null;
  let finished: Promise<void> | null = null;
  let markFinished = (): void => {};
  // Switching folders or quitting: nobody's waiting for the art or the summary.
  let stopping = false;
  let artCancelled = false;
  let lastChangedAt = Number.NEGATIVE_INFINITY;
  // A scan given up on can still be waiting for its art pass, and mustn't finish the one that came after it.
  let generation = 0;

  function setState(next: ScanState): void {
    state = next;
    deps.emitState(next);
  }

  function emitChangedThrottled(): void {
    deps.onCommitted();
    if (deps.now() - lastChangedAt < CHANGED_INTERVAL_MS) return;
    lastChangedAt = deps.now();
    deps.emitChanged(['library']);
  }

  function settle(lastReport: ScanReport | null): void {
    running = null;
    setState({ ...IDLE, lastReport: lastReport ?? state.lastReport });
    deps.emitChanged(['library']);
    markFinished();
  }

  async function runArtPhase(mine: number): Promise<void> {
    setState({ ...state, phase: 'art', filesFound: 0, filesDone: 0, currentPath: null });
    let lastProgressAt = Number.NEGATIVE_INFINITY;
    await deps.artPass((filesDone, filesFound) => {
      if (mine !== generation) return;
      if (filesDone < filesFound && deps.now() - lastProgressAt < ART_PROGRESS_INTERVAL_MS) return;
      lastProgressAt = deps.now();
      setState({ ...state, filesFound, filesDone });
    });
    if (mine === generation && !stopping && !artCancelled) await deps.pruneArt();
  }

  async function finishWith(outcome: ScanOutcome, mine: number): Promise<void> {
    if (outcome.kind === 'root-unreadable') {
      settle(null);
      deps.onRootUnreadable(outcome.message);
      return;
    }

    const { report } = outcome;
    deps.saveReport(report);
    deps.onCommitted();
    if (outcome.kind === 'finished' && !report.looksEmpty && !stopping) {
      try {
        await runArtPhase(mine);
      } catch (error) {
        deps.log.error('The art phase failed', error);
      }
    }
    if (mine !== generation) return;
    settle(report);

    if (stopping) return;
    if (report.looksEmpty) {
      deps.notify('warning', 'The library folder looks empty, so nothing was marked missing', {
        kind: 'open-storage',
        label: 'Open storage',
      });
      return;
    }
    const summary = summarize(report);
    const action = report.issues > 0 ? ({ kind: 'open-storage', label: 'See issues' } as const) : null;
    if (summary !== null) deps.notify('info', summary, action);
  }

  function onEvent(event: ScanEvent, mine: number): void {
    if (mine !== generation) return;
    switch (event.type) {
      case 'progress':
        setState({ ...state, ...event.progress });
        return;
      case 'committed':
        emitChangedThrottled();
        return;
      case 'done':
        finishWith(event.outcome, mine).catch((error: unknown) => {
          deps.log.error('Finishing the scan failed', error);
          if (mine === generation) settle(null);
        });
        return;
      case 'failed':
        deps.log.error('The scan failed', event.message, event.code);
        settle(null);
        if (isCorruptionCode(event.code)) deps.onCorrupt(event.message);
        else deps.notify('error', 'The scan stopped unexpectedly. The details are in the log.', null);
    }
  }

  return {
    state: () => state,
    isRunning: () => running !== null,

    start(job) {
      if (running) return err('scan_running', 'A scan is already running');
      stopping = false;
      artCancelled = false;
      lastChangedAt = Number.NEGATIVE_INFINITY;
      finished = new Promise((resolve) => {
        markFinished = resolve;
      });
      const mine = ++generation;
      setState({ ...IDLE, phase: 'walking', lastReport: state.lastReport });
      running = deps.run(job, (event) => onEvent(event, mine));
      return ok();
    },

    cancel() {
      if (state.phase === 'art') {
        artCancelled = true;
        deps.stopArtPass();
      } else {
        running?.cancel();
      }
    },

    async stop() {
      const current = running;
      const waiting = finished;
      if (!current || !waiting) return;

      stopping = true;
      current.cancel();
      deps.stopArtPass();

      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(true), CANCEL_GRACE_MS);
      });
      const tooSlow = await Promise.race([waiting.then(() => false), timedOut]);
      clearTimeout(timer);

      if (tooSlow) {
        generation++;
        await current.terminate();
        settle(null);
      }
    },

    forgetReport() {
      if (state.lastReport !== null) setState({ ...state, lastReport: null });
    },

    rememberReport(report) {
      if (JSON.stringify(report) !== JSON.stringify(state.lastReport)) setState({ ...state, lastReport: report });
    },
  };
}
