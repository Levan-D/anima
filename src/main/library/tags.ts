/* The edge where tags stop being outside data. Past this, the rest of the code trusts them. */

import type { IAudioMetadata, IFormat, ITag } from 'music-metadata';
import { nameOf } from '@main/library/relPath';

export const UNKNOWN_ARTIST = 'Unknown Artist';

const MIN_YEAR = 1000;
const MAX_YEAR = 2100;
const MAX_TRACK_OR_DISC = 9_999;
const MAX_FORMAT_NUMBER = 2 ** 31 - 1;

export type FileTags = {
  title: string;
  /** There was no title tag, so `title` is the file name. */
  titleIsFileName: boolean;
  artist: string;
  albumArtist: string;
  album: string | null;
  year: number | null;
  discNumber: number | null;
  trackNumber: number | null;
  genres: string[];
};

export type FileFormat = {
  codec: string;
  isLossless: boolean;
  sampleRate: number | null;
  bitDepth: number | null;
  channels: number | null;
  durationMs: number;
};

type Metadata = Pick<IAudioMetadata, 'common' | 'native'>;

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

function positive(value: number | null | undefined, max: number): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= max ? value : null;
}

function saneYear(value: number | undefined): number | null {
  return value !== undefined && Number.isInteger(value) && value >= MIN_YEAR && value <= MAX_YEAR ? value : null;
}

function nativeText(tags: ITag[] | undefined, ...ids: string[]): string | null {
  for (const { id, value } of tags ?? []) {
    if (ids.includes(id.toUpperCase()) && text(String(value)) !== null) return text(String(value));
  }
  return null;
}

function yearInDate(date: string | null): number | null {
  if (date === null) return null;
  const separate = /(?:^|\D)(\d{4})(?:\D|$)/.exec(date)?.[1];
  return saneYear(Number(separate ?? /^\d{4}/.exec(date)?.[0]));
}

// `common` is a mix per field: most follow a priority (Vorbis over ID3v2), but track and disc are whichever block was
// parsed last, and year can be set by an ID3v1 block even with a date in Vorbis. Those are read from the block itself.
function yearOf({ common, native }: Metadata): number | null {
  if (native.vorbis) return yearInDate(nativeText(native.vorbis, 'DATE'));
  return yearInDate(common.date ?? null) ?? saneYear(common.year);
}

const POSITION_BLOCKS = [
  { block: 'APEv2', track: 'TRACK', disc: 'DISC' },
  { block: 'ID3v2.4', track: 'TRCK', disc: 'TPOS' },
  { block: 'ID3v2.3', track: 'TRCK', disc: 'TPOS' },
  { block: 'ID3v2.2', track: 'TRK', disc: 'TPA' },
] as const;

function firstNumber(value: string | null): number | null {
  return value === null ? null : positive(Number.parseInt(value.split('/')[0] ?? '', 10), MAX_TRACK_OR_DISC);
}

/** The same priority `common` gives every other field, with Vorbis not sharing it: a FLAC's other blocks are leftovers. */
function positionOf({ common, native }: Metadata, field: 'track' | 'disc'): number | null {
  if (native.vorbis) return firstNumber(nativeText(native.vorbis, field === 'track' ? 'TRACKNUMBER' : 'DISCNUMBER'));
  for (const tags of POSITION_BLOCKS) {
    const found = firstNumber(nativeText(native[tags.block], tags[field]));
    if (found !== null) return found;
  }
  return positive(field === 'track' ? common.track.no : common.disk.no, MAX_TRACK_OR_DISC);
}

function albumArtistOf({ common, native }: Metadata): string | null {
  return native.vorbis ? nativeText(native.vorbis, 'ALBUMARTIST', 'ALBUM ARTIST') : text(common.albumartist);
}

/** There's a tag saying so, rather than the album being credited to the artist for want of one. */
export function hasAlbumArtistTag(metadata: Metadata): boolean {
  return albumArtistOf(metadata) !== null;
}

// Not `common.genre`, which also takes the Vorbis STYLE tag, and a leftover ID3 frame in a FLAC.
function vorbisGenres(tags: ITag[]): string[] {
  return tags.filter(({ id }) => id.toUpperCase() === 'GENRE').map(({ value }) => String(value));
}

function genresOf(values: string[] | undefined): string[] {
  const seen = new Map<string, string>();
  for (const value of (values ?? []).flatMap((genre) => genre.split(';'))) {
    const genre = value.trim();
    const key = genre.toLowerCase();
    if (genre !== '' && !seen.has(key)) seen.set(key, genre);
  }
  return [...seen.values()];
}

function fileNameWithoutExtension(relPath: string): string {
  const name = nameOf(relPath);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/** `id3v2Genres` is what the file's TCON frame really says, when that's where its genre comes from. */
export function normalizeTags(metadata: Metadata, relPath: string, id3v2Genres: string[] | null = null): FileTags {
  const { common, native } = metadata;
  const title = text(common.title);
  const tagArtist = text(common.artist);
  const tagAlbumArtist = albumArtistOf(metadata);
  const artist = tagArtist ?? tagAlbumArtist ?? UNKNOWN_ARTIST;
  return {
    title: title ?? fileNameWithoutExtension(relPath),
    titleIsFileName: title === null,
    artist,
    albumArtist: tagAlbumArtist ?? artist,
    album: text(common.album),
    year: yearOf(metadata),
    discNumber: positionOf(metadata, 'disc'),
    trackNumber: positionOf(metadata, 'track'),
    genres: genresOf(native.vorbis ? vorbisGenres(native.vorbis) : (id3v2Genres ?? common.genre)),
  };
}

function codecName(format: IFormat, relPath: string): string {
  const codec = text(format.codec);
  if (codec === null) return text(format.container) ?? relPath.slice(relPath.lastIndexOf('.') + 1).toUpperCase();
  return /^MPEG .* Layer 3$/.test(codec) ? 'MP3' : codec;
}

/** A header can make this NaN or Infinity (a sample rate of 0, say), and a track can't be that long. */
function durationMsOf({ duration }: IFormat): number {
  const ms = Math.round((duration ?? 0) * 1000);
  return Number.isSafeInteger(ms) && ms > 0 ? ms : 0;
}

export function normalizeFormat(format: IFormat, relPath: string): FileFormat {
  return {
    codec: codecName(format, relPath),
    isLossless: format.lossless ?? false,
    sampleRate: positive(format.sampleRate, MAX_FORMAT_NUMBER),
    bitDepth: positive(format.bitsPerSample, MAX_FORMAT_NUMBER),
    channels: positive(format.numberOfChannels, MAX_FORMAT_NUMBER),
    durationMs: durationMsOf(format),
  };
}

/** music-metadata finishes happily on a file with no frames in it. This is how to tell. */
export function hasAudioStream(format: IFormat): boolean {
  return format.hasAudio !== false && (format.codec !== undefined || format.sampleRate !== undefined);
}
