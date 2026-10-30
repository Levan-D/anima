import { describe, expect, it, vi } from 'vitest';
import type { ScanReport, ScanState } from '@shared/domain';
import { createScanner, summarize, type ScanEvent, type ScannerDeps } from '@main/library/scanner';

function report(overrides: Partial<ScanReport> = {}): ScanReport {
  return {
    finishedAt: 1,
    durationMs: 1,
    cancelled: false,
    looksEmpty: false,
    added: 0,
    updated: 0,
    moved: 0,
    nowMissing: 0,
    restored: 0,
    unchanged: 0,
    issues: 0,
    ...overrides,
  };
}

const JOB = { root: 'root', dbPath: 'db', hostname: 'host' };

function setUp(overrides: Partial<ScannerDeps> = {}) {
  let send: (event: ScanEvent) => void = () => {};
  let time = 1000;
  const states: ScanState[] = [];
  const changed: string[][] = [];
  const running = { cancel: vi.fn(), terminate: vi.fn(() => Promise.resolve()) };
  const deps: ScannerDeps = {
    run: (_job, onEvent) => {
      send = onEvent;
      return running;
    },
    emitState: (state) => states.push(state),
    emitChanged: (scopes) => changed.push(scopes),
    notify: vi.fn(),
    log: { error: vi.fn() },
    now: () => time,
    artPass: vi.fn(() => Promise.resolve()),
    stopArtPass: vi.fn(),
    pruneArt: vi.fn(() => Promise.resolve()),
    onCommitted: vi.fn(),
    onRootUnreadable: vi.fn(),
    onCorrupt: vi.fn(),
    ...overrides,
  };
  return {
    scanner: createScanner(deps),
    deps,
    states,
    changed,
    running,
    send: (event: ScanEvent) => send(event),
    advance: (ms: number) => {
      time += ms;
    },
    settled: () => vi.waitFor(() => expect(states.at(-1)?.phase).toBe('idle')),
  };
}

describe('summarize', () => {
  it('says so when nothing changed in a library with something in it', () => {
    expect(summarize(report({ unchanged: 5000 }))).toBe('Library is up to date');
  });

  it('lists only what happened', () => {
    expect(summarize(report({ added: 1234, nowMissing: 2 }))).toBe('Scan finished: 1,234 added, 2 now missing');
    expect(summarize(report({ updated: 1, moved: 2, restored: 3, issues: 4 }))).toBe(
      'Scan finished: 1 updated, 2 moved, 3 restored, 4 with issues',
    );
  });

  it('says when it was cancelled', () => {
    expect(summarize(report({ cancelled: true }))).toBe('Scan cancelled');
    expect(summarize(report({ cancelled: true, added: 3 }))).toBe('Scan cancelled: 3 added');
  });

  it('has nothing to add when the folder had nothing in it, which the screen already says', () => {
    expect(summarize(report())).toBeNull();
  });
});

describe('createScanner', () => {
  it('starts in idle, with no report', () => {
    expect(setUp().scanner.state()).toEqual({
      phase: 'idle',
      filesFound: 0,
      filesDone: 0,
      currentPath: null,
      lastReport: null,
    });
  });

  it('refuses a second scan', () => {
    const { scanner } = setUp();
    expect(scanner.start(JOB).ok).toBe(true);
    expect(scanner.start(JOB)).toMatchObject({ ok: false, error: { code: 'scan_running' } });
  });

  it('passes progress on', () => {
    const { scanner, send, states } = setUp();
    scanner.start(JOB);
    send({ type: 'progress', progress: { phase: 'reading', filesFound: 9, filesDone: 3, currentPath: 'a/b.flac' } });
    expect(states.at(-1)).toMatchObject({ phase: 'reading', filesFound: 9, filesDone: 3, currentPath: 'a/b.flac' });
  });

  it('tells the lists to refresh at most every 1.5 seconds, and once at the end', async () => {
    const { scanner, send, changed, advance, settled } = setUp();
    scanner.start(JOB);

    send({ type: 'committed' });
    expect(changed).toHaveLength(1);
    advance(500);
    send({ type: 'committed' });
    advance(500);
    send({ type: 'committed' });
    expect(changed).toHaveLength(1);
    advance(600);
    send({ type: 'committed' });
    expect(changed).toHaveLength(2);

    send({ type: 'done', outcome: { kind: 'finished', report: report() } });
    await settled();
    expect(changed).toHaveLength(3);
  });

  it('keeps the status fresh on every commit', () => {
    const { scanner, send, deps } = setUp();
    scanner.start(JOB);
    send({ type: 'committed' });
    send({ type: 'committed' });
    expect(deps.onCommitted).toHaveBeenCalledTimes(2);
  });

  it('runs the art phase after a finished scan, then prunes, then reports', async () => {
    const order: string[] = [];
    const { scanner, send, settled, states, deps } = setUp({
      artPass: () => {
        order.push('art');
        return Promise.resolve();
      },
      pruneArt: () => {
        order.push('prune');
        return Promise.resolve();
      },
    });
    scanner.start(JOB);
    send({ type: 'done', outcome: { kind: 'finished', report: report({ added: 1 }) } });
    await settled();

    expect(order).toEqual(['art', 'prune']);
    expect(states.map(({ phase }) => phase)).toContain('art');
    expect(states.at(-1)?.lastReport).toMatchObject({ added: 1 });
    expect(deps.notify).toHaveBeenCalledWith('info', 'Scan finished: 1 added', null);
  });

  it('throttles art progress, but always shows the last of it', async () => {
    const { scanner, send, settled, states, advance } = setUp({
      artPass: (onProgress) => {
        for (let done = 0; done < 50; done++) onProgress(done, 50);
        advance(300);
        onProgress(25, 50);
        onProgress(50, 50);
        return Promise.resolve();
      },
    });
    scanner.start(JOB);
    send({ type: 'done', outcome: { kind: 'finished', report: report() } });
    await settled();

    const art = states.filter(({ phase, filesFound }) => phase === 'art' && filesFound > 0);
    expect(art.map(({ filesDone }) => filesDone)).toEqual([0, 25, 50]);
  });

  it('skips the art phase after a cancelled scan', async () => {
    const { scanner, send, settled, deps } = setUp();
    scanner.start(JOB);
    send({ type: 'done', outcome: { kind: 'cancelled', report: report({ cancelled: true }) } });
    await settled();
    expect(deps.artPass).not.toHaveBeenCalled();
    expect(deps.notify).toHaveBeenCalledWith('info', 'Scan cancelled', null);
  });

  it('skips the art phase when the folder looks empty, and warns instead of summarizing', async () => {
    const { scanner, send, settled, deps } = setUp();
    scanner.start(JOB);
    send({ type: 'done', outcome: { kind: 'finished', report: report({ looksEmpty: true }) } });
    await settled();
    expect(deps.artPass).not.toHaveBeenCalled();
    expect(deps.pruneArt).not.toHaveBeenCalled();
    expect(deps.notify).toHaveBeenCalledWith(
      'warning',
      expect.stringContaining('looks empty'),
      expect.objectContaining({ kind: 'open-storage' }),
    );
  });

  it('points at storage when there were issues', async () => {
    const { scanner, send, settled, deps } = setUp();
    scanner.start(JOB);
    send({ type: 'done', outcome: { kind: 'finished', report: report({ issues: 2 }) } });
    await settled();
    expect(deps.notify).toHaveBeenCalledWith(
      'info',
      'Scan finished: 2 with issues',
      expect.objectContaining({ kind: 'open-storage' }),
    );
  });

  it('survives an art phase that fails', async () => {
    const { scanner, send, settled, deps } = setUp({ artPass: () => Promise.reject(new Error('no')) });
    scanner.start(JOB);
    send({ type: 'done', outcome: { kind: 'finished', report: report({ added: 1 }) } });
    await settled();
    expect(deps.log.error).toHaveBeenCalled();
    expect(scanner.state().lastReport).toMatchObject({ added: 1 });
  });

  it('cancels the worker while scanning, and the art pass during the art phase', async () => {
    let finishArt = (): void => {};
    const { scanner, send, running, deps, settled } = setUp({
      artPass: () =>
        new Promise((resolve) => {
          finishArt = resolve;
        }),
    });
    scanner.start(JOB);
    scanner.cancel();
    expect(running.cancel).toHaveBeenCalledTimes(1);

    send({ type: 'done', outcome: { kind: 'finished', report: report() } });
    await vi.waitFor(() => expect(scanner.state().phase).toBe('art'));
    scanner.cancel();
    expect(running.cancel).toHaveBeenCalledTimes(1);
    expect(deps.stopArtPass).toHaveBeenCalled();

    finishArt();
    await settled();
    expect(deps.pruneArt).not.toHaveBeenCalled();
  });

  it('re-evaluates when the folder could not be read, and leaves saying so to whatever that decides', async () => {
    const { scanner, send, settled, deps } = setUp();
    scanner.start(JOB);
    send({ type: 'done', outcome: { kind: 'root-unreadable', message: 'gone' } });
    await settled();
    expect(deps.onRootUnreadable).toHaveBeenCalledWith('gone');
    expect(deps.artPass).not.toHaveBeenCalled();
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it('says nothing about a folder with nothing in it', async () => {
    const { scanner, send, settled, deps } = setUp();
    scanner.start(JOB);
    send({ type: 'done', outcome: { kind: 'finished', report: report() } });
    await settled();
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it('forgets the report on request, and says so', async () => {
    const { scanner, send, settled, states } = setUp();
    scanner.start(JOB);
    send({ type: 'done', outcome: { kind: 'cancelled', report: report({ cancelled: true }) } });
    await settled();
    expect(scanner.state().lastReport).not.toBeNull();

    scanner.forgetReport();
    expect(scanner.state().lastReport).toBeNull();
    expect(states.at(-1)?.lastReport).toBeNull();
  });

  it('turns a failure into a notice, and can scan again', () => {
    const { scanner, send, deps } = setUp();
    scanner.start(JOB);
    send({ type: 'failed', message: 'it broke', code: null });
    expect(deps.notify).toHaveBeenCalledWith('error', expect.any(String), null);
    expect(deps.onCorrupt).not.toHaveBeenCalled();
    expect(scanner.isRunning()).toBe(false);
    expect(scanner.start(JOB).ok).toBe(true);
  });

  it('calls a failure from a damaged database what it is', () => {
    const { scanner, send, deps } = setUp();
    scanner.start(JOB);
    send({ type: 'failed', message: 'malformed', code: 'SQLITE_CORRUPT_VTAB' });
    expect(deps.onCorrupt).toHaveBeenCalledWith('malformed');
  });

  describe('stop', () => {
    it('does nothing with no scan', async () => {
      const { scanner, running } = setUp();
      await scanner.stop();
      expect(running.cancel).not.toHaveBeenCalled();
    });

    it('waits for the worker to finish the current file, and tells nobody', async () => {
      const { scanner, send, running, deps } = setUp();
      scanner.start(JOB);
      const stopping = scanner.stop();
      expect(running.cancel).toHaveBeenCalled();
      send({ type: 'done', outcome: { kind: 'cancelled', report: report({ cancelled: true }) } });
      await stopping;
      expect(running.terminate).not.toHaveBeenCalled();
      expect(scanner.isRunning()).toBe(false);
      expect(deps.notify).not.toHaveBeenCalled();
    });

    it('starts no art for a scan that finishes just as it stops', async () => {
      const { scanner, send, deps } = setUp();
      scanner.start(JOB);
      const stopping = scanner.stop();
      send({ type: 'done', outcome: { kind: 'finished', report: report() } });
      await stopping;
      expect(deps.artPass).not.toHaveBeenCalled();
    });

    it('forces the end when the worker takes too long', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        const { scanner, running } = setUp();
        scanner.start(JOB);
        const stopping = scanner.stop();
        await vi.advanceTimersByTimeAsync(6_000);
        await stopping;
        expect(running.terminate).toHaveBeenCalled();
        expect(scanner.isRunning()).toBe(false);
        expect(scanner.state().phase).toBe('idle');
      } finally {
        vi.useRealTimers();
      }
    });

    it('a scan given up on in its art phase cannot finish the next one', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        let finishOldArt = (): void => {};
        let progressOldArt: (done: number, total: number) => void = () => {};
        const { scanner, send, deps, states } = setUp({
          artPass: (onProgress) => {
            progressOldArt = onProgress;
            return new Promise((resolve) => {
              finishOldArt = resolve;
            });
          },
        });

        scanner.start(JOB);
        send({ type: 'done', outcome: { kind: 'finished', report: report({ added: 1 }) } });
        await vi.waitFor(() => expect(scanner.state().phase).toBe('art'));

        const stopping = scanner.stop();
        await vi.advanceTimersByTimeAsync(6_000);
        await stopping;
        expect(scanner.isRunning()).toBe(false);

        expect(scanner.start(JOB).ok).toBe(true);
        send({ type: 'progress', progress: { phase: 'reading', filesFound: 9, filesDone: 3, currentPath: null } });

        const seen = states.length;
        progressOldArt(1, 2);
        finishOldArt();
        await vi.advanceTimersByTimeAsync(0);

        expect(states).toHaveLength(seen);
        expect(scanner.isRunning()).toBe(true);
        expect(scanner.state().phase).toBe('reading');
        expect(scanner.start(JOB)).toMatchObject({ ok: false, error: { code: 'scan_running' } });
        expect(deps.pruneArt).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('ignores what an old worker still says after it was given up on', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        const { scanner, send, states } = setUp();
        scanner.start(JOB);
        const oldSend = send;
        const stopping = scanner.stop();
        await vi.advanceTimersByTimeAsync(6_000);
        await stopping;

        const seen = states.length;
        oldSend({ type: 'progress', progress: { phase: 'hashing', filesFound: 1, filesDone: 1, currentPath: null } });
        expect(states).toHaveLength(seen);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
