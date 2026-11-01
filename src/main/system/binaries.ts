import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { FINGERPRINT_MODEL_FILE } from '@main/fingerprints/model';

type Env = {
  isPackaged: boolean;
  resourcesPath: string;
  appRoot: string;
  exists?: (path: string) => boolean;
};

export type Binary = {
  path: string;
  found: boolean;
};

export type Binaries = {
  mpv: Binary;
  ffmpeg: Binary;
  fingerprintModel: Binary;
  /** Where the heads that read fingerprints sit, each of which may be missing by itself. */
  modelsDir: string;
};

export function resolveBinaries({ isPackaged, resourcesPath, appRoot, exists = existsSync }: Env): Binaries {
  const mpv = isPackaged ? join(resourcesPath, 'mpv', 'mpv.exe') : join(appRoot, 'resources', 'mpv', 'mpv.exe');
  const ffmpeg = isPackaged
    ? join(resourcesPath, 'ffmpeg', 'ffmpeg.exe')
    : join(appRoot, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe');

  const modelsDir = join(isPackaged ? resourcesPath : join(appRoot, 'resources'), 'models');
  const fingerprintModel = join(modelsDir, FINGERPRINT_MODEL_FILE);

  return {
    mpv: { path: mpv, found: exists(mpv) },
    ffmpeg: { path: ffmpeg, found: exists(ffmpeg) },
    fingerprintModel: { path: fingerprintModel, found: exists(fingerprintModel) },
    modelsDir,
  };
}
