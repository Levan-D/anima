import { parentPort, workerData } from 'node:worker_threads';
import { decodePeaks, type DecodeJob } from '@main/waveform/decode';
import type { WaveformWorkerEvent } from '@main/waveform/waveforms';

const stopping = new AbortController();
parentPort?.once('message', () => stopping.abort());

void decodePeaks(workerData as DecodeJob, stopping.signal).then((peaks) => {
  const event: WaveformWorkerEvent = { peaks };
  parentPort?.postMessage(event, peaks === null ? [] : [peaks.buffer as ArrayBuffer]);
  parentPort?.close();
});
