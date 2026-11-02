import { existsSync, mkdirSync } from 'node:fs';
import { hostname } from 'node:os';
import { shell } from 'electron';
import type { RevealTarget, StorageInfo } from '@shared/domain';
import { err, ok, type Result } from '@shared/result';
import type { HandlerGroup } from '@main/ipc';
import type { ArtCache } from '@main/library/artCache';
import type { Library } from '@main/library/library';
import { engineVersion } from '@main/playback/engineVersion';
import type { Binaries } from '@main/system/binaries';
import { ffmpegVersion } from '@main/system/binaryVersion';
import { nearestFolder } from '@main/system/nearestFolder';

type Paths = {
  settingsPath: string;
  logsPath: string;
};

const NOT_THERE = "That isn't there any more";
const NOT_ON_THIS_DEVICE = "That file isn't on this device";

/** Only ever given paths main worked out itself. */
async function openFolder(path: string): Promise<Result<void>> {
  const problem = await shell.openPath(path);
  return problem === '' ? ok() : err('file_missing', problem);
}

function showFile(path: string): Result<void> {
  if (!existsSync(path)) return err('file_missing', NOT_THERE);
  shell.showItemInFolder(path);
  return ok();
}

/** Being gone is the usual reason to ask: a notice about a track that was skipped offers this. */
function revealTrack(library: Library, trackId: number): Result<void> | Promise<Result<void>> {
  const path = library.absolutePath(trackId);
  const root = library.folder();
  if (path === null || root === null) return err('file_missing', NOT_ON_THIS_DEVICE);
  if (existsSync(path)) return showFile(path);

  const folder = nearestFolder(path, root, existsSync);
  return folder === null ? err('file_missing', NOT_ON_THIS_DEVICE) : openFolder(folder);
}

export function storageHandlers(
  library: Library,
  art: ArtCache,
  binaries: Binaries,
  { settingsPath, logsPath }: Paths,
) {
  async function storageInfo(): Promise<Result<StorageInfo>> {
    const [cacheBytes, mpvVersion, ffmpeg] = await Promise.all([
      art.sizeBytes(),
      engineVersion(binaries.mpv.path),
      ffmpegVersion(binaries.ffmpeg.path),
    ]);
    return ok({
      ...library.storedInfo(),
      cachePath: art.cacheDir,
      cacheBytes,
      settingsPath,
      logsPath,
      thisMachine: hostname(),
      engine: {
        mpvPath: binaries.mpv.path,
        mpvFound: binaries.mpv.found,
        mpvVersion,
        ffmpegPath: binaries.ffmpeg.path,
        ffmpegFound: binaries.ffmpeg.found,
        ffmpegVersion: ffmpeg,
      },
    });
  }

  const reveal: Record<RevealTarget, () => Result<void> | Promise<Result<void>>> = {
    library() {
      const folder = library.folder();
      return folder === null ? err('no_library', 'Pick a library folder first') : openFolder(folder);
    },
    database() {
      const path = library.storedInfo().databasePath;
      return path === null ? err('no_library', "The library isn't open") : showFile(path);
    },
    cache() {
      mkdirSync(art.cacheDir, { recursive: true });
      return openFolder(art.cacheDir);
    },
    logs: () => (existsSync(logsPath) ? openFolder(logsPath) : err('file_missing', NOT_THERE)),
    settings: () => showFile(settingsPath),
  };

  return {
    'system.storageInfo': storageInfo,
    'system.revealPath': ({ target }) => reveal[target](),
    'system.revealTrack': ({ trackId }) => revealTrack(library, trackId),
  } satisfies HandlerGroup;
}
