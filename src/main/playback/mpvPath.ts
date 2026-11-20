import { win32 } from 'node:path';

// mpv still opens files under Windows' old limit, 260 with the closing null, and Node doesn't, so a scan can find a
// file mpv can't open.
const MAX_PATH = 260;
const LONG_PREFIX = '\\\\?\\';

/** A path as mpv can open it. A long one goes in the \\?\ form, which skips the limit but has to be absolute and whole. */
export function mpvPath(path: string): string {
  if (path.length < MAX_PATH || path.startsWith(LONG_PREFIX)) return path;
  const whole = win32.resolve(path);
  return whole.startsWith('\\\\') ? `${LONG_PREFIX}UNC\\${whole.slice(2)}` : `${LONG_PREFIX}${whole}`;
}
