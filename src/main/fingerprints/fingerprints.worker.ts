import { parentPort, workerData } from 'node:worker_threads';
import { runFingerprints, type FingerprintJob } from './embed';

const stopping = new AbortController();
parentPort?.once('message', () => stopping.abort());

void runFingerprints(workerData as FingerprintJob, stopping.signal, (event) => parentPort?.postMessage(event)).finally(
  () => parentPort?.close(),
);
