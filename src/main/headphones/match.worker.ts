import { parentPort, workerData } from 'node:worker_threads';
import { matchBands, type MatchInput } from '@shared/headphoneMatch';
import { errorText } from '@shared/result';

try {
  parentPort?.postMessage({ ok: true, value: matchBands(workerData as MatchInput) });
} catch (error) {
  parentPort?.postMessage({ ok: false, message: errorText(error) });
} finally {
  parentPort?.close();
}
