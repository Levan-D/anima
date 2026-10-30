import { readdir, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
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

export async function walkLibrary(root: string, { isCancelled, onFound }: Options): Promise<WalkResult> {
  const result: WalkResult = { files: [], images: new Map(), unreadable: [], rootError: null, cancelled: false };
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
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        result.unreadable.push({ relPath: childPath(folder, entry.name), message: LINK });
      } else if (entry.isDirectory()) {
        if (!isSkippedFolder(entry.name)) folders.push(childPath(folder, entry.name));
      } else if (entry.isFile()) {
        if (isAudioFile(entry.name)) audio.push(entry.name);
        else if (isFolderImage(entry.name)) images.push(entry.name);
      }
    }
    if (images.length > 0) result.images.set(folder, images);

    await Promise.all(
      audio.map(async (name) => {
        const relPath = childPath(folder, name);
        try {
          const { size, mtimeMs } = await stat(toAbsolute(root, relPath));
          result.files.push({ relPath, sizeBytes: size, mtimeMs: Math.trunc(mtimeMs) });
        } catch (error) {
          result.unreadable.push({ relPath, message: `${UNREADABLE} ${errorText(error)}` });
        }
      }),
    );
    onFound(result.files.length, folder);
  }

  result.files.sort(byRelPath);
  return result;
}
