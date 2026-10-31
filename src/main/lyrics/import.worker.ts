import { parentPort, workerData } from 'node:worker_threads';
import { runLyricsImport, type ImportJob } from './import';

parentPort?.postMessage(runLyricsImport(workerData as ImportJob));
