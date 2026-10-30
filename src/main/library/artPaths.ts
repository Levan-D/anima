/* Where cached art lives. Both halves of the art cache need this, and main's half mustn't load the worker's. */

import { stat } from 'node:fs/promises';
import { join } from 'node:path';

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
};

function shard(cacheDir: string, hash: string): string {
  return join(cacheDir, hash.slice(0, 2));
}

export function fullImagePath(cacheDir: string, hash: string, mime: string): string {
  return join(shard(cacheDir, hash), `${hash}.${EXTENSION_BY_MIME[mime] ?? 'img'}`);
}

export function thumbnailPath(cacheDir: string, hash: string): string {
  return join(shard(cacheDir, hash), `${hash}.thumb.jpg`);
}

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
