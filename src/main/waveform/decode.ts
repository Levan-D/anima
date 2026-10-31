import { spawn } from 'node:child_process';
import type { WaveformData } from '@shared/domain';
import { createPeakCollector, DECODE_SAMPLE_RATE } from '@main/waveform/peaks';

export type DecodeJob = {
  ffmpegPath: string;
  path: string;
  durationMs: number;
};

/** Null when it failed or was stopped, which is never more than no waveform. Aborting kills ffmpeg. */
export function decodePeaks(
  { ffmpegPath, path, durationMs }: DecodeJob,
  signal: AbortSignal,
  start: typeof spawn = spawn,
): Promise<WaveformData | null> {
  if (durationMs <= 0 || signal.aborted) return Promise.resolve(null);

  return new Promise((resolve) => {
    const args = ['-nostdin', '-v', 'error', '-i', path, '-vn', '-ac', '1', '-ar', String(DECODE_SAMPLE_RATE)];
    const child = start(ffmpegPath, [...args, '-f', 's16le', 'pipe:1'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      signal,
    });
    const collector = createPeakCollector(durationMs);
    child.stdout.on('data', (chunk: Buffer) => collector.add(chunk));
    child.once('error', () => resolve(null));
    child.once('close', (code) => resolve(code === 0 && !signal.aborted ? collector.finish() : null));
  });
}
