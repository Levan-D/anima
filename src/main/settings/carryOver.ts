import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { err, errorText, ok, type Result } from '@shared/result';

/** The app was called this before it was anima, and Windows named its data folder after it. */
export const OLD_DATA_FOLDER_NAME = 'Music Player';

// Logs stay behind, and the rest of that folder is Chromium's own.
const CARRIED = ['settings.json', 'art-cache'];

/**
 * Moves the settings and the art cache over from the old name's folder, once: only while the new folder has no
 * settings. A move on the same drive is instant, whatever the cache's size. Says what it moved.
 */
export function carryOverData(from: string, to: string): Result<string[]> {
  if (existsSync(join(to, 'settings.json')) || !existsSync(join(from, 'settings.json'))) return ok([]);
  const moved: string[] = [];
  try {
    mkdirSync(to, { recursive: true });
    for (const name of CARRIED) {
      if (existsSync(join(to, name)) || !existsSync(join(from, name))) continue;
      renameSync(join(from, name), join(to, name));
      moved.push(name);
    }
  } catch (error) {
    return err('carry_over_failed', `Moved ${moved.join(', ') || 'nothing'}, then: ${errorText(error)}`);
  }
  return ok(moved);
}
