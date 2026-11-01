/* What the Library report needs to know about a file that the rest of the app doesn't keep. Reads, and never writes. */

import { open } from 'node:fs/promises';
import { extname } from 'node:path';
import { parseFile, type IAudioMetadata } from 'music-metadata';
import { afterId3v2, afterPadding, readAt } from '@main/library/audioHash';
import { hasAlbumArtistTag } from '@main/library/tags';

const HEAD_BYTES = 16 * 1024;
const TRACK_GAIN = 'REPLAYGAIN_TRACK_GAIN';

export type FileFacts = {
  hasReplayGain: boolean;
  hasAlbumArtist: boolean;
  /** Null for anything but an MP3, or when its first frame couldn't be found. */
  hasGaplessHeader: boolean | null;
};

/** Where a Xing or Info header sits from the frame's start, or null if these bytes aren't a Layer III frame header. */
function xingOffset(bytes: Buffer, at: number): number | null {
  const [b0, b1, b2, b3] = [bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]];
  if (b0 !== 0xff || b1 === undefined || b2 === undefined || b3 === undefined) return null;
  const version = (b1 >> 3) & 3;
  const isSynced = (b1 & 0xe0) === 0xe0;
  const isLayer3 = ((b1 >> 1) & 3) === 1;
  const bitrate = b2 >> 4;
  const rate = (b2 >> 2) & 3;
  if (!isSynced || version === 1 || !isLayer3 || bitrate === 0 || bitrate === 15 || rate === 3) return null;
  const isMono = b3 >> 6 === 3;
  if (version === 3) return isMono ? 21 : 36;
  return isMono ? 13 : 21;
}

/** Whether the first frame holds a header that can say what's padding. Without one, a player can't be gapless. */
export function holdsGaplessHeader(bytes: Buffer): boolean | null {
  for (let at = 0; at + 4 <= bytes.length; at += 1) {
    const offset = xingOffset(bytes, at);
    if (offset !== null) {
      const tag = bytes.toString('latin1', at + offset, at + offset + 4);
      return tag === 'Xing' || tag === 'Info';
    }
  }
  return null;
}

export async function readGaplessHeader(path: string): Promise<boolean | null> {
  if (extname(path).toLowerCase() !== '.mp3') return null;
  try {
    const file = await open(path, 'r');
    try {
      const { size } = await file.stat();
      const start = await afterPadding(file, await afterId3v2(file, 0), size);
      return holdsGaplessHeader(await readAt(file, start, HEAD_BYTES));
    } finally {
      await file.close();
    }
  } catch {
    return null;
  }
}

/**
 * The track gain is what counts: without one mpv applies nothing, whatever the album tag says. An ID3v2 tag's id comes
 * as `TXXX:REPLAYGAIN_TRACK_GAIN`, and any block can hold it.
 */
export function hasTrackGain({ native }: Pick<IAudioMetadata, 'native'>): boolean {
  return Object.values(native).some((tags) => tags.some(({ id }) => id.toUpperCase().endsWith(TRACK_GAIN)));
}

export async function factsFrom(metadata: Pick<IAudioMetadata, 'common' | 'native'>, path: string): Promise<FileFacts> {
  return {
    hasReplayGain: hasTrackGain(metadata),
    hasAlbumArtist: hasAlbumArtistTag(metadata),
    hasGaplessHeader: await readGaplessHeader(path),
  };
}

/** Throws what `parseFile` throws. Covers and frames are skipped, so a file costs a few small reads. */
export async function readFileFacts(path: string): Promise<FileFacts> {
  return factsFrom(await parseFile(path, { skipCovers: true, duration: false }), path);
}
