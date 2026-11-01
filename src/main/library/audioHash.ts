/*
 * What identifies a recording when its path has changed: a hash of the audio only, so retagging
 * doesn't change it. FLAC keeps an MD5 of its samples in the header, and music-metadata 12 doesn't
 * surface it (format.audioMD5 is only set for WavPack), so this reads it from the file.
 */
import { createHash } from 'node:crypto';
import { open, type FileHandle } from 'node:fs/promises';
import { extname } from 'node:path';

const CHUNK_BYTES = 1024 * 1024;
const ID3V2_HEADER_BYTES = 10;
const ID3V1_BYTES = 128;
const APE_FOOTER_BYTES = 32;
const FLAC_MARKER = 'fLaC';
const STREAMINFO_MD5_OFFSET = 18;
const MD5_BYTES = 16;

type IsCancelled = () => boolean;

export async function readAt(file: FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await file.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead);
}

function syncSafe(bytes: Buffer, offset: number): number {
  return (
    ((bytes[offset] ?? 0) << 21) |
    ((bytes[offset + 1] ?? 0) << 14) |
    ((bytes[offset + 2] ?? 0) << 7) |
    (bytes[offset + 3] ?? 0)
  );
}

/** Where the data starts once any ID3v2 tags are skipped. FLAC files can carry one too. */
export async function afterId3v2(file: FileHandle, start: number): Promise<number> {
  let position = start;
  for (;;) {
    const header = await readAt(file, position, ID3V2_HEADER_BYTES);
    if (header.length < ID3V2_HEADER_BYTES || header.toString('latin1', 0, 3) !== 'ID3') return position;
    const hasFooter = ((header[5] ?? 0) & 0x10) !== 0;
    position += ID3V2_HEADER_BYTES + syncSafe(header, 6) + (hasFooter ? ID3V2_HEADER_BYTES : 0);
  }
}

/** Taggers pad differently, and not all of them count the padding in the tag's size. */
export async function afterPadding(file: FileHandle, start: number, end: number): Promise<number> {
  let position = start;
  while (position < end) {
    const chunk = await readAt(file, position, Math.min(CHUNK_BYTES, end - position));
    if (chunk.length === 0) return position;
    const firstByte = chunk.findIndex((byte) => byte !== 0);
    if (firstByte !== -1) return position + firstByte;
    position += chunk.length;
  }
  return position;
}

/** Where the audio ends once ID3v1 and APEv2 are skipped, in whichever order they were written. */
async function beforeTrailingTags(file: FileHandle, start: number, size: number): Promise<number> {
  let end = size;
  for (;;) {
    if (end - ID3V1_BYTES >= start) {
      const marker = await readAt(file, end - ID3V1_BYTES, 3);
      if (marker.toString('latin1') === 'TAG') {
        end -= ID3V1_BYTES;
        continue;
      }
    }
    if (end - APE_FOOTER_BYTES >= start) {
      const footer = await readAt(file, end - APE_FOOTER_BYTES, APE_FOOTER_BYTES);
      if (footer.toString('latin1', 0, 8) === 'APETAGEX') {
        const claimed = footer.readUInt32LE(12);
        const hasHeader = (footer.readUInt32LE(20) & 0x80000000) !== 0;
        const tagBytes = claimed + (hasHeader ? APE_FOOTER_BYTES : 0);
        // A footer's size counts the footer. One claiming less, or more than the file holds, is damage, not a tag.
        if (claimed < APE_FOOTER_BYTES || tagBytes > end - start) return end;
        end -= tagBytes;
        continue;
      }
    }
    return end;
  }
}

/** Null when cancelled. A whole file can take a while, and a stuck drive shouldn't hold up the cancel. */
async function hashRange(
  file: FileHandle,
  start: number,
  end: number,
  isCancelled: IsCancelled,
): Promise<string | null> {
  const hash = createHash('sha1');
  const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
  let position = start;
  while (position < end) {
    if (isCancelled()) return null;
    const { bytesRead } = await file.read(buffer, 0, Math.min(CHUNK_BYTES, end - position), position);
    if (bytesRead === 0) break;
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return hash.digest('hex');
}

async function labelled(label: string, hash: Promise<string | null>): Promise<string | null> {
  const value = await hash;
  return value === null ? null : `${label}:${value}`;
}

async function mp3Hash(file: FileHandle, size: number, isCancelled: IsCancelled): Promise<string | null> {
  const end = await beforeTrailingTags(file, 0, size);
  const start = await afterPadding(file, await afterId3v2(file, 0), end);
  // Tags that leave no room for audio are damaged, and every such file would hash alike.
  if (start >= end && size > 0) return labelled('file', hashRange(file, 0, size, isCancelled));
  return labelled('frames', hashRange(file, start, end, isCancelled));
}

type FlacHash = { known: boolean; hash: string | null };

async function flacHash(file: FileHandle, size: number, isCancelled: IsCancelled): Promise<FlacHash> {
  const notFlac: FlacHash = { known: false, hash: null };
  const start = await afterId3v2(file, 0);
  const marker = await readAt(file, start, FLAC_MARKER.length);
  if (marker.toString('latin1') !== FLAC_MARKER) return notFlac;

  let position = start + FLAC_MARKER.length;
  const first = await readAt(file, position, 4 + STREAMINFO_MD5_OFFSET + MD5_BYTES);
  if (first.length < 4 + STREAMINFO_MD5_OFFSET + MD5_BYTES || ((first[0] ?? 0) & 0x7f) !== 0) return notFlac;

  const md5 = first.subarray(4 + STREAMINFO_MD5_OFFSET);
  if (md5.some((byte) => byte !== 0)) return { known: true, hash: `flac-md5:${md5.toString('hex')}` };

  // The encoder left the MD5 unset, so hash the frames, which start after the last metadata block.
  for (;;) {
    const header = await readAt(file, position, 4);
    if (header.length < 4) return notFlac;
    position += 4 + header.readUIntBE(1, 3);
    if (((header[0] ?? 0) & 0x80) !== 0) break;
  }
  const end = await beforeTrailingTags(file, position, size);
  return { known: true, hash: await labelled('frames', hashRange(file, position, end, isCancelled)) };
}

/** Null when the file can't be read, or when told to stop. A file with no hash just can't be recognized after a move. */
export async function audioHash(path: string, isCancelled: IsCancelled = () => false): Promise<string | null> {
  try {
    const file = await open(path, 'r');
    try {
      const { size } = await file.stat();
      const extension = extname(path).toLowerCase();
      if (extension === '.mp3') return await mp3Hash(file, size, isCancelled);
      if (extension === '.flac') {
        const { known, hash } = await flacHash(file, size, isCancelled);
        if (known) return hash;
      }
      return await labelled('file', hashRange(file, 0, size, isCancelled));
    } finally {
      await file.close();
    }
  } catch {
    return null;
  }
}
