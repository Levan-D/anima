import { dirname, isAbsolute, relative } from 'node:path';

function isInside(folder: string, root: string): boolean {
  const path = relative(root, folder);
  return !isAbsolute(path) && path !== '..' && !path.startsWith('..\\') && !path.startsWith('../');
}

/** For a file that's gone: the closest folder above it that's still there, without going above `root`. */
export function nearestFolder(path: string, root: string, exists: (path: string) => boolean): string | null {
  for (let folder = dirname(path); isInside(folder, root); folder = dirname(folder)) {
    if (exists(folder)) return folder;
    if (folder === dirname(folder)) return null;
  }
  return null;
}
