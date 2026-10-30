import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { askTheBinary, versionOnce } from '@main/system/binaryVersion';

async function readMpvVersion(path: string): Promise<string | null> {
  const recorded = await readFile(join(dirname(path), '.version'), 'utf8').catch(() => '');
  // --version prints and exits before anything touches an audio device.
  return recorded.trim() || askTheBinary(path, ['--no-config', '--version'], /^mpv (\S+)/);
}

/** The version of the bundled engine, for Settings. */
export function engineVersion(path: string): Promise<string | null> {
  return versionOnce(path, () => readMpvVersion(path));
}
