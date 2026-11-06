import { renameSync, writeFileSync } from 'node:fs';

const RENAME_ATTEMPTS = 20;

/**
 * Written beside it and renamed over it, so a crash halfway leaves the old file whole. Throws if it can't be done: what
 * calls it decides what a failed save means.
 */
export function writeAtomically(path: string, text: string): void {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, text);
  // Windows refuses a rename now and then while something else has the old file open for a moment, such as a virus scan.
  for (let attemptsLeft = RENAME_ATTEMPTS; ; attemptsLeft--) {
    try {
      renameSync(temporary, path);
      return;
    } catch (error) {
      if (attemptsLeft <= 1) throw error;
    }
  }
}
