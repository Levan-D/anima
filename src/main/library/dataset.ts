import { ok } from '@shared/result';
import type { Dataset } from '@main/datasets/datasets';
import type { Library } from './library';

/** A rescan as one of the things Settings' Data tab can update. The scan's own progress line shows as well. */
export function libraryDataset(library: Library): Dataset {
  return {
    counts() {
      const { counts } = library.storedInfo();
      return ok({ done: counts.tracks, missing: counts.missing, detail: null });
    },
    problem: () => null,
    lastRunAt: () => library.storedInfo().lastScanAt,
    start(_options, onProgress) {
      const started = library.startScan();
      if (!started.ok) return started;
      return ok({
        cancel: () => library.cancelScan(),
        finished: new Promise((resolve) => {
          const stop = library.onScanState(({ phase, filesDone, filesFound }) => {
            onProgress({ done: filesDone, failed: 0, total: filesFound });
            if (phase !== 'idle') return;
            stop();
            resolve({ note: null });
          });
        }),
      });
    },
  };
}
