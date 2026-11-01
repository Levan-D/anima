/* An image's size from its first bytes, so measuring every cover in the library takes no decoding. */

import { open, readFile } from 'node:fs/promises';

const HEAD_BYTES = 256 * 1024;
const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

export type ImageSize = {
  width: number;
  height: number;
};

function sized(width: number, height: number): ImageSize | null {
  return width > 0 && height > 0 ? { width, height } : null;
}

function jpegSize(bytes: Buffer): ImageSize | null {
  let position = 2;
  while (position + 9 <= bytes.length) {
    if (bytes[position] !== 0xff) return null;
    const marker = bytes[position + 1] ?? 0;
    // A marker can be padded with any number of 0xff.
    if (marker === 0xff) {
      position += 1;
      continue;
    }
    if (JPEG_SOF.has(marker)) return sized(bytes.readUInt16BE(position + 7), bytes.readUInt16BE(position + 5));
    position += 2 + bytes.readUInt16BE(position + 2);
  }
  return null;
}

function webpSize(bytes: Buffer): ImageSize | null {
  const chunk = bytes.toString('latin1', 12, 16);
  if (chunk === 'VP8X' && bytes.length >= 30) {
    return sized(bytes.readUIntLE(24, 3) + 1, bytes.readUIntLE(27, 3) + 1);
  }
  if (chunk === 'VP8L' && bytes.length >= 25) {
    const bits = bytes.readUInt32LE(21);
    return sized((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
  }
  if (chunk === 'VP8 ' && bytes.length >= 30) {
    return sized(bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff);
  }
  return null;
}

/** Null when these bytes don't say: not an image, or a JPEG whose size comes later than them. */
export function imageSize(bytes: Buffer): ImageSize | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpegSize(bytes);
  if (bytes.length >= 24 && bytes.toString('latin1', 1, 4) === 'PNG') {
    return sized(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
  }
  if (bytes.length >= 10 && bytes.toString('latin1', 0, 3) === 'GIF') {
    return sized(bytes.readUInt16LE(6), bytes.readUInt16LE(8));
  }
  if (bytes.length >= 26 && bytes.toString('latin1', 0, 2) === 'BM') {
    return sized(bytes.readInt32LE(18), Math.abs(bytes.readInt32LE(22)));
  }
  if (bytes.length >= 16 && bytes.toString('latin1', 8, 12) === 'WEBP') return webpSize(bytes);
  return null;
}

/** A JPEG can carry a big ICC profile or thumbnail ahead of its size, and only then is it read whole. */
export async function readImageSize(path: string): Promise<ImageSize | null> {
  try {
    const file = await open(path, 'r');
    let head: Buffer;
    let isWhole: boolean;
    try {
      const buffer = Buffer.alloc(HEAD_BYTES);
      const { bytesRead } = await file.read(buffer, 0, HEAD_BYTES, 0);
      head = buffer.subarray(0, bytesRead);
      isWhole = bytesRead < HEAD_BYTES;
    } finally {
      await file.close();
    }
    return imageSize(head) ?? (isWhole ? null : imageSize(await readFile(path)));
  } catch {
    return null;
  }
}
