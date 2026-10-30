import { parentPort, workerData } from 'node:worker_threads';
import type { ArtWorkerCommand, ArtWorkerConfig, ArtWorkerEvent } from '@main/library/artCache';
import { createArtQueue } from '@main/library/artQueue';

const { cacheDir, ffmpegPath } = workerData as ArtWorkerConfig;

function post(event: ArtWorkerEvent): void {
  parentPort?.postMessage(event);
}

const queue = createArtQueue({ cacheDir, ffmpegPath, onDone: (result) => post({ type: 'done', result }) });

async function handle(command: ArtWorkerCommand): Promise<void> {
  switch (command.type) {
    case 'job':
      queue.push(command.job, command.urgent);
      return;
    case 'drop-background':
      queue.dropBackground();
      return;
    case 'stop':
      await queue.stop();
      parentPort?.close();
  }
}

parentPort?.on('message', (command: ArtWorkerCommand) => {
  handle(command).catch((error: unknown) => post({ type: 'failed', message: String(error) }));
});
