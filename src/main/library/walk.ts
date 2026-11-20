import { lstat, readdir, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
import { errorText } from '@shared/result';
import { isFolderImage } from '@main/library/folderImage';
import type { FoundFile } from '@main/library/reconcile';
import { byRelPath, childPath, toAbsolute } from '@main/library/relPath';

const AUDIO_EXTENSIONS = new Set(['flac', 'mp3', 'm4a', 'ogg', 'opus', 'wav', 'aiff', 'aif', 'ape', 'wv']);
// Not everything with a leading dot: `...And Justice For All` and `.38 Special` are music.
const SKIPPED_FOLDERS = new Set(['.player', '$recycle.bin', 'system volume information']);

const UNREADABLE = "This couldn't be read, so nothing in it was marked missing.";
const LINK = "It's a link, and links aren't followed, so nothing behind it is in the library.";

type UnreadablePath = {
  relPath: string;
  /** Says why, for the scan report. */
  message: string;
};

export type WalkResult = {
  files: FoundFile[];
  sheets: FoundFile[];
  /** Folder image names, by folder. Kept apart from the audio because they cost nothing until one's needed. */
  images: Map<string, string[]>;
  /** Whatever the walk couldn't see into, or chose not to: what's known to be under these isn't gone. */
  unreadable: UnreadablePath[];
  /** Set when the library folder itself couldn't be read, which makes everything else meaningless. */
  rootError: string | null;
  cancelled: boolean;
};

type Options = {
  isCancelled: () => boolean;
  onFound: (filesFound: number, folder: string) => void;
};

function isSkippedFolder(name: string): boolean {
  return SKIPPED_FOLDERS.has(name.toLowerCase());
}

function isAudioFile(name: string): boolean {
  if (name.startsWith('._')) return false;
  const dot = name.lastIndexOf('.');
  return dot !== -1 && AUDIO_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

function isCueSheet(name: string): boolean {
  return !name.startsWith('._') && name.toLowerCase().endsWith('.cue');
}

type EntryKind = 'link' | 'folder' | 'file' | 'other' | { error: string };

/**
 * readdir on Windows calls every reparse point a link, and OneDrive's files and folders are reparse points. lstat
 * only calls symlinks and junctions links, so it decides.
 */
async function kindOf(entry: Dirent, folder: string): Promise<EntryKind> {
  let found: Pick<Dirent, 'isSymbolicLink' | 'isDirectory' | 'isFile'> = entry;
  if (entry.isSymbolicLink()) {
    try {
      found = await lstat(join(folder, entry.name));
    } catch (error) {
      return { error: errorText(error) };
    }
  }
  if (found.isSymbolicLink()) return 'link';
  if (found.isDirectory()) return 'folder';
  if (found.isFile()) return 'file';
  return 'other';
}

export async function walkLibrary(root: string, { isCancelled, onFound }: Options): Promise<WalkResult> {
  const result: WalkResult = {
    files: [],
    sheets: [],
    images: new Map(),
    unreadable: [],
    rootError: null,
    cancelled: false,
  };
  const folders = [''];

  for (let folder = folders.pop(); folder !== undefined; folder = folders.pop()) {
    if (isCancelled()) {
      result.cancelled = true;
      return result;
    }

    let entries: Dirent[];
    try {
      entries = await readdir(toAbsolute(root, folder), { withFileTypes: true });
    } catch (error) {
      if (folder === '') {
        result.rootError = errorText(error);
        return result;
      }
      result.unreadable.push({ relPath: folder, message: `${UNREADABLE} ${errorText(error)}` });
      continue;
    }

    const audio: string[] = [];
    const images: string[] = [];
    const sheets: string[] = [];
    const kinds = await Promise.all(entries.map((entry) => kindOf(entry, toAbsolute(root, folder))));
    for (const [i, entry] of entries.entries()) {
      const kind = kinds[i];
      if (kind === 'link') {
        result.unreadable.push({ relPath: childPath(folder, entry.name), message: LINK });
      } else if (typeof kind === 'object') {
        result.unreadable.push({ relPath: childPath(folder, entry.name), message: `${UNREADABLE} ${kind.error}` });
      } else if (kind === 'folder') {
        if (!isSkippedFolder(entry.name)) folders.push(childPath(folder, entry.name));
      } else if (kind === 'file') {
        if (isAudioFile(entry.name)) audio.push(entry.name);
        else if (isFolderImage(entry.name)) images.push(entry.name);
        else if (isCueSheet(entry.name)) sheets.push(entry.name);
      }
    }
    if (images.length > 0) result.images.set(folder, images);

    const statInto = (into: FoundFile[]) => async (name: string) => {
      const relPath = childPath(folder, name);
      try {
        const { size, mtimeMs } = await stat(toAbsolute(root, relPath));
        into.push({ relPath, sizeBytes: size, mtimeMs: Math.trunc(mtimeMs) });
      } catch (error) {
        result.unreadable.push({ relPath, message: `${UNREADABLE} ${errorText(error)}` });
      }
    };
    await Promise.all([...audio.map(statInto(result.files)), ...sheets.map(statInto(result.sheets))]);
    onFound(result.files.length, folder);
  }

  result.files.sort(byRelPath);
  result.sheets.sort(byRelPath);
  return result;
}
