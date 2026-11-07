import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DATA_FOLDER = '.player';
const DATABASE_FILE = 'library.db';
const BACKUPS_FOLDER = 'backups';
const SETTINGS_FILE = 'settings.json';
const HEADPHONES_FOLDER = 'headphones';

/** Everything the player keeps that's the person's, in one folder beside the music. */
export type LibraryPaths = {
  dataDir: string;
  dbPath: string;
  backupsDir: string;
  /** The person's settings: EQ and its presets, seasons, radio and the like. */
  settingsPath: string;
  headphonesDir: string;
};

/**
 * `devDataRoot` stands in for the music folder during development and tests, so nothing is
 * written there, and hashing the path means two folders never share a database.
 */
export function libraryPaths(folder: string, devDataRoot: string | null): LibraryPaths {
  const key = createHash('sha1').update(resolve(folder).toLowerCase()).digest('hex').slice(0, 8);
  const dataDir = devDataRoot === null ? join(folder, DATA_FOLDER) : join(devDataRoot, key);
  return {
    dataDir,
    dbPath: join(dataDir, DATABASE_FILE),
    backupsDir: join(dataDir, BACKUPS_FOLDER),
    settingsPath: join(dataDir, SETTINGS_FILE),
    headphonesDir: join(dataDir, HEADPHONES_FOLDER),
  };
}

/** What stopped it, or null when the folder can be created and written to. */
export function writeProblem(dir: string): unknown {
  const probe = join(dir, `.write-test-${process.pid}`);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(probe, '');
    rmSync(probe);
    return null;
  } catch (error) {
    return error;
  }
}
