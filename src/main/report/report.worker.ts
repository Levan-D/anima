import { parentPort, workerData } from 'node:worker_threads';
import { errorText } from '@shared/result';
import { runReportJob, type ReportJob } from './jobs';

try {
  parentPort?.postMessage({ ok: true, value: await runReportJob(workerData as ReportJob) });
} catch (error) {
  parentPort?.postMessage({ ok: false, message: errorText(error) });
} finally {
  parentPort?.close();
}
