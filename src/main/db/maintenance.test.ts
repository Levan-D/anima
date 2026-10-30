import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { maintenanceInWorker, type MaintenanceEvent } from '@main/db/maintenance';
import { tempDir } from '@main/library/testFixtures';

vi.setConfig({ testTimeout: 30_000 });

const JOB = { dbPath: '', backupsDir: '', now: 0 };

function workerScript(body: string): string {
  const path = join(tempDir('maintenance-worker'), 'worker.mjs');
  writeFileSync(path, `import { parentPort } from 'node:worker_threads';\n${body}`);
  return path;
}

describe('maintenanceInWorker', () => {
  it('lets a worker finish rather than ending it mid-way, which can abort the whole process during load', async () => {
    const path = workerScript(`setTimeout(() => parentPort.postMessage({ type: 'backup', path: 'finished' }), 300);`);
    const events: MaintenanceEvent[] = [];

    await maintenanceInWorker(path)(JOB, (event) => events.push(event)).stop();

    expect(events).toEqual([{ type: 'backup', path: 'finished' }]);
  });

  it('ends one that never finishes, after giving it the chance', async () => {
    const path = workerScript(
      `setInterval(() => parentPort.postMessage({ type: 'failed', message: 'still here' }), 50);`,
    );
    const events: MaintenanceEvent[] = [];
    const started = performance.now();

    await maintenanceInWorker(path)(JOB, (event) => events.push(event)).stop();

    expect(performance.now() - started).toBeGreaterThanOrEqual(2_900);
    const seen = events.length;
    await new Promise((done) => setTimeout(done, 200));
    expect(events).toHaveLength(seen);
  });

  it('reports a worker that throws', async () => {
    const path = workerScript(`throw new Error('it broke');`);
    const events: MaintenanceEvent[] = [];
    await maintenanceInWorker(path)(JOB, (event) => events.push(event)).stop();
    expect(events).toEqual([{ type: 'failed', message: 'it broke' }]);
  });
});
