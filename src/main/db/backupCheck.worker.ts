import { parentPort, workerData } from 'node:worker_threads';
import { newestUsableBackup } from '@main/db/backups';

parentPort?.postMessage(newestUsableBackup(workerData as string));
