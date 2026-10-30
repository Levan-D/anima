import { folderOf, childPath, nameOf } from '@main/library/relPath';

const NAMES = ['cover', 'folder', 'front', 'album', 'albumart'];
const EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];

// Only whole names, so AlbumArtSmall.jpg and AlbumArt_{GUID}_Large.jpg, which Windows Media Player leaves behind, never match.
const RANKED = NAMES.flatMap((name) => EXTENSIONS.map((extension) => `${name}.${extension}`));
const RANK = new Map(RANKED.map((name, rank) => [name, rank]));

const DISC_FOLDER = /^(cd|disc|disk)[\s._-]*\d+$/i;

export function isFolderImage(fileName: string): boolean {
  return RANK.has(fileName.toLowerCase());
}

export function isDiscFolder(folderName: string): boolean {
  return DISC_FOLDER.test(folderName);
}

function best(fileNames: string[]): string | null {
  const ranked = fileNames.toSorted(
    (a, b) => (RANK.get(a.toLowerCase()) ?? RANKED.length) - (RANK.get(b.toLowerCase()) ?? RANKED.length),
  );
  return ranked[0] ?? null;
}

/** `images` holds the folder images the walk saw, by folder. A disc folder also looks at its parent. */
export function folderImageFor(audioRelPath: string, images: ReadonlyMap<string, string[]>): string | null {
  const folder = folderOf(audioRelPath);
  const own = best(images.get(folder) ?? []);
  if (own !== null) return childPath(folder, own);
  if (folder === '' || !isDiscFolder(nameOf(folder))) return null;

  const parent = folderOf(folder);
  const shared = best(images.get(parent) ?? []);
  return shared === null ? null : childPath(parent, shared);
}

/** Every name a file's folder image could have, for when nobody's looked at the folder itself. */
export function folderImageCandidates(audioRelPath: string): string[] {
  const folder = folderOf(audioRelPath);
  const folders = folder !== '' && isDiscFolder(nameOf(folder)) ? [folder, folderOf(folder)] : [folder];
  return folders.flatMap((inFolder) => RANKED.map((name) => childPath(inFolder, name)));
}

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export function mimeOfImagePath(relPath: string): string {
  const extension = relPath.slice(relPath.lastIndexOf('.') + 1).toLowerCase();
  return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream';
}
