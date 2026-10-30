import { parentPort, workerData } from 'node:worker_threads';
import { runMaintenance, type MaintenanceJob } from '@main/db/maintenance';

runMaintenance(workerData as MaintenanceJob, (event) => parentPort?.postMessage(event));
