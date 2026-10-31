import { parentPort, workerData } from 'node:worker_threads';
import { decodePeaks, type DecodeJob } from '@main/waveform/decode';
import type { WaveformWorkerEvent } from '@main/waveform/waveforms';

const stopping = new AbortController();
parentPort?.once('message', () => stopping.abort());

void decodePeaks(workerData as DecodeJob, stopping.signal).then((levels) => {
  const event: WaveformWorkerEvent = { levels };
  const buffers = levels === null ? [] : [levels.peaks.buffer as ArrayBuffer, levels.rms.buffer as ArrayBuffer];
  parentPort?.postMessage(event, buffers);
  parentPort?.close();
});
