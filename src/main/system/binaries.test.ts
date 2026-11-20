import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveBinaries } from '@main/system/binaries';

const resourcesPath = join('C:', 'Program Files', 'anima', 'resources');
const appRoot = join('C:', 'repo');

describe('resolveBinaries', () => {
  it('finds them in the resources folder when packaged', () => {
    const { mpv, ffmpeg } = resolveBinaries({ isPackaged: true, resourcesPath, appRoot, exists: () => true });
    expect(mpv.path).toBe(join(resourcesPath, 'mpv', 'mpv.exe'));
    expect(ffmpeg.path).toBe(join(resourcesPath, 'ffmpeg', 'ffmpeg.exe'));
  });

  it('finds them in the repo during development', () => {
    const { mpv, ffmpeg } = resolveBinaries({ isPackaged: false, resourcesPath, appRoot, exists: () => true });
    expect(mpv.path).toBe(join(appRoot, 'resources', 'mpv', 'mpv.exe'));
    expect(ffmpeg.path).toBe(join(appRoot, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe'));
  });

  it('reports each one on its own, keeping the path it looked at', () => {
    const { mpv, ffmpeg } = resolveBinaries({
      isPackaged: false,
      resourcesPath,
      appRoot,
      exists: (path) => path.endsWith('mpv.exe'),
    });
    expect(mpv.found).toBe(true);
    expect(ffmpeg).toEqual({ path: join(appRoot, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe'), found: false });
  });
});
