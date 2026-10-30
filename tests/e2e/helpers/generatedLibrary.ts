/*
 * A believable library, made with ffmpeg at test time and kept in .dev: real tags, real embedded art, real lengths.
 * The audio is silence, so a track costs a few kilobytes. It's built once, and a test gets its own copy to break.
 */
import { execFile } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const ROOT = resolve(import.meta.dirname, '../../..');
const FFMPEG = join(ROOT, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe');
const VERSION = 'v1';
const CACHE = join(ROOT, '.dev', 'fixtures', `browse-library-${VERSION}`);
const MUSIC = join(CACHE, 'Music');
const COVERS = join(CACHE, 'covers');
const CONCURRENCY = 8;

const run = promisify(execFile);

export const LONG_ALBUM_TITLE =
  'The Extraordinarily Long And Winding Title Of An Album That Refuses To Fit On Any Reasonable Line Of Text, Volume II';
export const LONG_ARTIST_NAME =
  'The Philharmonic Orchestra And Chorus Of The Greater Metropolitan Area Under The Direction Of Somebody Famous';

type AlbumSpec = {
  artist: string;
  album: string;
  year: number | null;
  genre: string;
  /** Null makes it an album with no art at all. */
  cover: [string, string] | null;
  tracks: string[];
  discs?: number;
  albumArtist?: string;
  /** A different artist per track, as on a compilation. */
  trackArtists?: string[];
  codec?: 'flac' | 'mp3';
};

const WORDS_A = ['Quiet', 'Paper', 'Marble', 'Northern', 'Velvet', 'Cinder', 'Juniper', 'Silver', 'Hollow', 'Amber'];
const WORDS_B = ['Harbour', 'Moons', 'Arch', 'Line', 'Static', 'Road', 'Hall', 'Rain', 'Hours', 'Fields', 'Light'];
const TRACK_WORDS = [
  'Morning',
  'Glass',
  'Second Hand',
  'Long Way Home',
  'Weather',
  'Slow Train',
  'The Low Road',
  'Paper Boats',
  'Undertow',
  'Lantern',
  'Salt',
  'After Hours',
  'Evergreen',
  'Cold Water',
];
const GENRES = ['Ambient', 'Folk', 'Jazz', 'Post-Rock', 'Electronic', 'Soul', 'Classical', 'Dream Pop'];
const ARTISTS = [
  'Harbour Lights',
  'Marble Arch',
  'Ostara',
  'The Northern Line',
  'Sable & Stone',
  'Juniper Hall',
  'Paper Moons',
  'Cinder Road',
  'Velvet Static',
  'Orchard Street',
  'Tidewater',
  'Low Meadow',
];
const COVER_COLORS: [string, string][] = [
  ['0x1f3a5f', '0xc9a227'],
  ['0x7a1f3d', '0x1c1c3a'],
  ['0x0f4c3a', '0xd9ed92'],
  ['0xd8572a', '0x3d0c02'],
  ['0x2d3142', '0xbfc0c0'],
  ['0x6a4c93', '0xf2d7ee'],
  ['0x0b132b', '0x5bc0be'],
  ['0xe9c46a', '0x264653'],
  ['0x3a0ca3', '0xf72585'],
  ['0x283618', '0xdda15e'],
  ['0x14213d', '0xfca311'],
  ['0x5f0f40', '0xfb8b24'],
];

function pick<T>(from: readonly T[], index: number): T {
  const value = from[index % from.length];
  if (value === undefined) throw new Error('Picked from an empty list');
  return value;
}

function trackNames(count: number, seed: number): string[] {
  return Array.from({ length: count }, (_, index) => {
    const word = pick(TRACK_WORDS, seed + index);
    return index % 3 === 0 ? `${word} ${pick(WORDS_B, seed + index)}` : word;
  });
}

function albums(): AlbumSpec[] {
  const regular = Array.from({ length: 44 }, (_, index): AlbumSpec => {
    const artistIndex = Math.floor(index / 2);
    return {
      artist: pick(ARTISTS, artistIndex),
      album: `${pick(WORDS_A, index)} ${pick(WORDS_B, index * 3)}`,
      year: 1985 + ((index * 7) % 40),
      genre: pick(GENRES, index),
      cover: pick(COVER_COLORS, index),
      tracks: trackNames(4 + (index % 5), index),
      codec: index % 6 === 5 ? 'mp3' : 'flac',
    };
  });

  return [
    ...regular,
    {
      artist: 'Björk',
      album: 'Homogénic',
      year: 1997,
      genre: 'Electronic',
      cover: ['0x8e3b46', '0x1b1b1e'],
      tracks: ['Jóga', 'Hunter', 'Bachelorette', 'Unravel'],
    },
    {
      artist: '東京事変',
      album: '大人 (アダルト)',
      year: 2006,
      genre: 'J-Pop',
      cover: ['0x1a1a2e', '0xe94560'],
      tracks: ['秘密', '喧嘩上等', '手紙', '修羅場'],
    },
    {
      artist: 'Мумий Тролль',
      album: 'Морская',
      year: 1997,
      genre: 'Rock',
      cover: ['0x023e8a', '0xcaf0f8'],
      tracks: ['Утекай', 'Девочка', 'Кот кота'],
    },
    {
      artist: LONG_ARTIST_NAME,
      album: LONG_ALBUM_TITLE,
      year: 2019,
      genre: 'Classical',
      cover: ['0x3c1642', '0x086375'],
      tracks: [
        'A Track Whose Name Goes On For So Long That No Row Could Possibly Show All Of It Without An Ellipsis Somewhere',
        'Short',
      ],
    },
    {
      artist: 'Marble Arch',
      album: 'Complete Recordings',
      year: 2012,
      genre: 'Jazz',
      cover: ['0x212529', '0xadb5bd'],
      tracks: trackNames(18, 3),
      discs: 3,
    },
    {
      artist: 'Tidewater',
      album: 'Bare Sleeve',
      year: 2003,
      genre: 'Folk',
      cover: null,
      tracks: trackNames(5, 9),
    },
    {
      artist: 'Various Artists',
      albumArtist: 'Various Artists',
      album: 'Late Night Tapes',
      year: 2015,
      genre: 'Soul',
      cover: ['0x370617', '0xf48c06'],
      tracks: trackNames(6, 5),
      trackArtists: ['Harbour Lights', 'Ostara', 'Velvet Static', 'Low Meadow', 'Paper Moons', 'Orchard Street'],
    },
    {
      artist: 'Low Meadow',
      album: 'Field Recordings',
      year: null,
      genre: 'Ambient',
      cover: ['0x344e41', '0xa3b18a'],
      tracks: trackNames(30, 1),
    },
  ];
}

function safeName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, '')
    .slice(0, 60)
    .trim();
}

function ffmpeg(args: string[]) {
  return run(FFMPEG, ['-nostdin', '-y', '-hide_banner', '-loglevel', 'error', ...args], { windowsHide: true });
}

async function inBatches<T>(items: T[], work: (item: T) => Promise<unknown>): Promise<void> {
  for (let start = 0; start < items.length; start += CONCURRENCY) {
    await Promise.all(items.slice(start, start + CONCURRENCY).map(work));
  }
}

type FileSpec = {
  path: string;
  seconds: number;
  cover: string | null;
  mp3: boolean;
  tags: Record<string, string>;
};

function writeTrack({ path, seconds, cover, mp3, tags }: FileSpec) {
  mkdirSync(dirname(path), { recursive: true });
  return ffmpeg([
    '-f',
    'lavfi',
    '-i',
    `anullsrc=r=8000:cl=mono:d=${seconds}`,
    ...(cover ? ['-i', cover, '-map', '0:a', '-map', '1:v', '-c:v', 'copy', '-disposition:v', 'attached_pic'] : []),
    ...(mp3 ? ['-c:a', 'libmp3lame', '-b:a', '8k', '-id3v2_version', '3'] : []),
    ...Object.entries(tags).flatMap(([key, value]) => ['-metadata', `${key}=${value}`]),
    path,
  ]);
}

function coverPath([from, to]: [string, string]): string {
  return join(COVERS, `${from}-${to}.jpg`);
}

function filesOf(spec: AlbumSpec, albumIndex: number): FileSpec[] {
  const folder = join(MUSIC, safeName(spec.artist), safeName(spec.album));
  const discs = spec.discs ?? 1;
  const perDisc = Math.ceil(spec.tracks.length / discs);

  return spec.tracks.map((title, index) => {
    const number = (index % perDisc) + 1;
    const disc = Math.floor(index / perDisc) + 1;
    const extension = spec.codec === 'mp3' ? 'mp3' : 'flac';
    return {
      path: join(folder, `${disc}-${String(number).padStart(2, '0')} ${safeName(title)}.${extension}`),
      seconds: 95 + ((albumIndex * 37 + index * 53) % 300),
      cover: spec.cover ? coverPath(spec.cover) : null,
      mp3: spec.codec === 'mp3',
      tags: {
        title,
        artist: spec.trackArtists?.[index] ?? spec.artist,
        album: spec.album,
        genre: spec.genre,
        track: String(number),
        ...(spec.year === null ? {} : { date: String(spec.year) }),
        ...(discs > 1 ? { disc: String(disc) } : {}),
        ...(spec.albumArtist ? { album_artist: spec.albumArtist } : {}),
      },
    };
  });
}

async function build(): Promise<void> {
  rmSync(CACHE, { recursive: true, force: true });
  mkdirSync(COVERS, { recursive: true });

  const specs = albums();
  const covers = [...new Set(specs.flatMap(({ cover }) => (cover ? [cover] : [])))];
  await inBatches(covers, (cover) =>
    ffmpeg([
      '-f',
      'lavfi',
      '-i',
      `gradients=s=600x600:c0=${cover[0]}:c1=${cover[1]}:x0=0:y0=0:x1=600:y1=600:nb_colors=2:d=1`,
      '-frames:v',
      '1',
      coverPath(cover),
    ]),
  );

  const files = specs.flatMap(filesOf);
  files.push(
    {
      path: join(MUSIC, 'Loose Ends', 'No Album Here.flac'),
      seconds: 61,
      cover: null,
      mp3: false,
      tags: { title: 'No Album Here', artist: 'Loose Ends', genre: 'Folk' },
    },
    {
      path: join(MUSIC, 'Untagged', 'an untagged file.flac'),
      seconds: 62,
      cover: null,
      mp3: false,
      tags: {},
    },
  );
  await inBatches(files, writeTrack);

  mkdirSync(join(MUSIC, 'Broken'), { recursive: true });
  writeFileSync(join(MUSIC, 'Broken', 'corrupt.flac'), 'this is not a flac file at all');
  writeFileSync(join(CACHE, 'ready'), '');
}

export type GeneratedLibrary = {
  /** The library's folder, which is this test's own to change. */
  folder: string;
  trackCount: number;
  albumCount: number;
};

/** Puts a fresh copy of the library at `target`. */
export async function generatedLibrary(target: string): Promise<GeneratedLibrary> {
  if (!existsSync(join(CACHE, 'ready'))) await build();
  rmSync(target, { recursive: true, force: true });
  mkdirSync(dirname(target), { recursive: true });
  cpSync(MUSIC, target, { recursive: true });

  const specs = albums();
  return {
    folder: target,
    trackCount: specs.reduce((sum, { tracks }) => sum + tracks.length, 0) + 2,
    albumCount: new Set(specs.map(({ artist, album }) => `${artist}|${album}`)).size,
  };
}
