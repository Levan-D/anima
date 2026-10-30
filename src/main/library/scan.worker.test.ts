/*
 * The real worker file in a real thread, which the other tests can't do because Vitest can't load
 * `?modulePath`. It's bundled here the way electron-vite does it, with the dependencies left external.
 */
import { copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { build } from 'vite';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Connection } from '@main/db/connection';
import type { ScanEvent, ScanJob } from '@main/library/scanner';
import {
  BASE_FILES_READABLE,
  closeTestDatabase,
  copyOfBaseLibrary,
  finishedScan,
  openTestDatabase,
  tempDir,
  TEST_ROOT,
} from '@main/library/testFixtures';

const BUNDLE = join(TEST_ROOT, 'scan-worker-bundle');

let root: string;
let dbPath: string;
let db: Connection;

function startWorker(job: ScanJob, onEvent: (event: ScanEvent) => void): Worker {
  const worker = new Worker(join(BUNDLE, 'scan.worker.js'), { workerData: job });
  worker.on('message', onEvent);
  return worker;
}

function exited(worker: Worker): Promise<number> {
  return new Promise((done) => worker.once('exit', done));
}

function rows(): { id: number; relPath: string; missingSince: number | null }[] {
  return db
    .prepare<[], { id: number; relPath: string; missingSince: number | null }>(
      'SELECT t.id, f.rel_path AS relPath, f.missing_since AS missingSince FROM tracks t JOIN files f ON f.id = t.file_id',
    )
    .all();
}

beforeAll(async () => {
  await build({
    configFile: false,
    logLevel: 'silent',
    resolve: { alias: { '@main': resolve('src/main'), '@shared': resolve('src/shared') } },
    build: {
      ssr: resolve('src/main/library/scan.worker.ts'),
      outDir: BUNDLE,
      emptyOutDir: true,
      rolldownOptions: { output: { entryFileNames: 'scan.worker.js' } },
    },
  });
}, 60_000);

beforeEach(() => {
  root = copyOfBaseLibrary('worker-lib');
  ({ dbPath, db } = openTestDatabase(tempDir('worker-data')));
});

afterEach(() => closeTestDatabase(db));

describe('the scan worker', () => {
  it('runs a scan on its own connection and reports back', async () => {
    const events: ScanEvent[] = [];
    const worker = startWorker({ root, dbPath, hostname: 'worker-test' }, (event) => events.push(event));
    expect(await exited(worker)).toBe(0);

    const done = events.at(-1);
    expect(done).toMatchObject({ type: 'done', outcome: { kind: 'finished', report: { added: BASE_FILES_READABLE } } });
    expect(events.some(({ type }) => type === 'progress')).toBe(true);
    expect(events.some(({ type }) => type === 'committed')).toBe(true);
    expect(rows()).toHaveLength(BASE_FILES_READABLE);
  });

  it('stops when told to', async () => {
    const events: ScanEvent[] = [];
    const worker = startWorker({ root, dbPath, hostname: 'worker-test' }, (event) => events.push(event));
    worker.postMessage('cancel');
    expect(await exited(worker)).toBe(0);
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: { kind: 'cancelled' } });
  });

  it('turns an error into a message instead of dying silently', async () => {
    const events: ScanEvent[] = [];
    const worker = startWorker({ root, dbPath: join(root, 'no', 'such.db'), hostname: 'worker-test' }, (event) =>
      events.push(event),
    );
    expect(await exited(worker)).toBe(0);
    expect(events.at(-1)).toMatchObject({ type: 'failed', message: expect.any(String) as string });
  });

  it('killed mid-way, leaves nothing marked missing, and a later scan just continues', async () => {
    const source = join(root, 'Artist One', 'Album A', '01 First.flac');
    for (let index = 0; index < 350; index++) copyFileSync(source, join(root, 'Artist One', `copy ${index}.flac`));
    const total = BASE_FILES_READABLE + 350;

    const killed = await new Promise<{ code: number }>((done) => {
      let terminated = false;
      const worker = startWorker({ root, dbPath, hostname: 'worker-test' }, (event) => {
        if (event.type === 'committed' && !terminated) {
          terminated = true;
          void worker.terminate().then((code) => done({ code }));
        }
      });
    });
    expect(killed.code).toBe(1);

    const survivors = rows();
    expect(survivors.length).toBeGreaterThanOrEqual(100);
    expect(survivors.length).toBeLessThan(total);
    expect(survivors.filter(({ missingSince }) => missingSince !== null)).toEqual([]);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');

    const { report } = await finishedScan(root, dbPath);
    expect(report).toMatchObject({ unchanged: survivors.length, added: total - survivors.length, nowMissing: 0 });

    const after = new Map(rows().map(({ relPath, id }) => [relPath, id]));
    expect(after.size).toBe(total);
    for (const { relPath, id } of survivors) expect(after.get(relPath)).toBe(id);
  }, 120_000);
});
