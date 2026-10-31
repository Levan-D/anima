/* Paths in the database are relative to the music folder, with forward slashes. */

import { join } from 'node:path';

export function toAbsolute(root: string, relPath: string): string {
  return join(root, ...relPath.split('/'));
}

/** Windows paths are case-insensitive, so this is what makes two of them the same file. */
export function caseKey(relPath: string): string {
  return relPath.toLowerCase();
}

export function folderOf(relPath: string): string {
  const slash = relPath.lastIndexOf('/');
  return slash === -1 ? '' : relPath.slice(0, slash);
}

export function nameOf(relPath: string): string {
  return relPath.slice(relPath.lastIndexOf('/') + 1);
}

export function childPath(folder: string, name: string): string {
  return folder === '' ? name : `${folder}/${name}`;
}

function compareKeys(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * For a row whose path another row has taken, and which has no file. The walk never goes into .player, so nothing can
 * ever be found here and rebind the row.
 */
export function displacedPath(id: number, relPath: string): string {
  return `.player/displaced/${id}/${nameOf(relPath)}`;
}

/**
 * Holds the tracks a file's CUE sheet no longer has, as missing tracks, with their playlists and stats. They go back
 * to the file if the sheet brings them back.
 */
export function parkedCuePath(fileId: number): string {
  return `.player/displaced/cue-${fileId}`;
}

export function byRelPath(a: { relPath: string }, b: { relPath: string }): number {
  return compareKeys(caseKey(a.relPath), caseKey(b.relPath)) || compareKeys(a.relPath, b.relPath);
}
