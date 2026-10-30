/*
 * music-metadata takes any "(...)" in an ID3v2 genre for an ID3v1 code and drops what it can't map, in `native` too, so
 * `Pop (indie)` comes out as `Pop`, while the same words in a FLAC stay whole. The text can't be had after parsing, so
 * this reads the frame itself. A file it can't make sense of gets null, and what music-metadata said stands.
 */
import { open, type FileHandle } from 'node:fs/promises';
import type { IAudioMetadata, ITag } from 'music-metadata';

const ID3V1_GENRES = (
  'Blues|Classic Rock|Country|Dance|Disco|Funk|Grunge|Hip-Hop|Jazz|Metal|New Age|Oldies|Other|Pop|R&B|Rap|Reggae|Rock|' +
  'Techno|Industrial|Alternative|Ska|Death Metal|Pranks|Soundtrack|Euro-Techno|Ambient|Trip-Hop|Vocal|Jazz+Funk|Fusion|' +
  'Trance|Classical|Instrumental|Acid|House|Game|Sound Clip|Gospel|Noise|Alt. Rock|Bass|Soul|Punk|Space|Meditative|' +
  'Instrumental Pop|Instrumental Rock|Ethnic|Gothic|Darkwave|Techno-Industrial|Electronic|Pop-Folk|Eurodance|Dream|' +
  'Southern Rock|Comedy|Cult|Gangsta Rap|Top 40|Christian Rap|Pop/Funk|Jungle|Native American|Cabaret|New Wave|' +
  'Psychedelic|Rave|Showtunes|Trailer|Lo-Fi|Tribal|Acid Punk|Acid Jazz|Polka|Retro|Musical|Rock & Roll|Hard Rock|Folk|' +
  'Folk/Rock|National Folk|Swing|Fast-Fusion|Bebob|Latin|Revival|Celtic|Bluegrass|Avantgarde|Gothic Rock|' +
  'Progressive Rock|Psychedelic Rock|Symphonic Rock|Slow Rock|Big Band|Chorus|Easy Listening|Acoustic|Humour|Speech|' +
  'Chanson|Opera|Chamber Music|Sonata|Symphony|Booty Bass|Primus|Porn Groove|Satire|Slow Jam|Club|Tango|Samba|Folklore|' +
  'Ballad|Power Ballad|Rhythmic Soul|Freestyle|Duet|Punk Rock|Drum Solo|A Cappella|Euro-House|Dance Hall|Goa|' +
  'Drum & Bass|Club-House|Hardcore|Terror|Indie|BritPop|Negerpunk|Polsk Punk|Beat|Christian Gangsta Rap|Heavy Metal|' +
  'Black Metal|Crossover|Contemporary Christian|Christian Rock|Merengue|Salsa|Thrash Metal|Anime|JPop|Synthpop|' +
  'Abstract|Art Rock|Baroque|Bhangra|Big Beat|Breakbeat|Chillout|Downtempo|Dub|EBM|Eclectic|Electro|Electroclash|Emo|' +
  'Experimental|Garage|Global|IDM|Illbient|Industro-Goth|Jam Band|Krautrock|Leftfield|Lounge|Math Rock|New Romantic|' +
  'Nu-Breakz|Post-Punk|Post-Rock|Psytrance|Shoegaze|Space Rock|Trop Rock|World Music|Neoclassical|Audiobook|' +
  'Audio Theatre|Neue Deutsche Welle|Podcast|Indie Rock|G-Funk|Dubstep|Garage Rock|Psybient'
).split('|');

const KEYWORDS: Record<string, string> = { RX: 'Remix', CR: 'Cover' };

const ID3_HEADER_BYTES = 10;

function referenceName(code: string): string | null {
  return KEYWORDS[code] ?? ID3V1_GENRES[Number(code)] ?? null;
}

/**
 * References only count at the start, as the standard has them: `(17)`, `(17)Rock`, `(51)(39)`, with `((` for a real
 * bracket. Anywhere else a bracket is just words.
 */
function genresInValue(value: string): string[] {
  const genres: string[] = [];
  let rest = value;
  for (;;) {
    const reference = /^\((\d+|RX|CR)\)/.exec(rest);
    if (!reference?.[1]) break;
    const name = referenceName(reference[1]);
    if (name !== null) genres.push(name);
    rest = rest.slice(reference[0].length);
  }
  if (rest.startsWith('((')) rest = rest.slice(1);

  const bare = rest.trim();
  if (genres.length === 0 && /^\d+$/.test(bare)) {
    const name = referenceName(bare);
    return name === null ? [] : [name];
  }
  return bare === '' ? genres : [...genres, bare];
}

/** The genres in a TCON frame's text, whose values are separated by NUL. */
export function genresFromTcon(text: string): string[] {
  return text.split('\0').flatMap((value) => genresInValue(value.replaceAll('\uFEFF', '').trim()));
}

function decodeText(data: Uint8Array): string {
  const bytes = Buffer.from(data.subarray(1));
  switch (data[0]) {
    case 0:
      return bytes.toString('latin1');
    case 3:
      return bytes.toString('utf8');
    case 1:
    case 2: {
      const even = bytes.subarray(0, bytes.length - (bytes.length % 2));
      const isBigEndian = data[0] === 2 || (even[0] === 0xfe && even[1] === 0xff);
      return (isBigEndian ? Buffer.from(even).swap16() : even).toString('utf16le');
    }
    default:
      return '';
  }
}

function removeUnsync(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  let length = 0;
  for (let index = 0; index < bytes.length; index++) {
    const byte = bytes[index] ?? 0;
    out[length++] = byte;
    if (byte === 0xff && bytes[index + 1] === 0) index++;
  }
  return out.subarray(0, length);
}

function syncSafe(bytes: Uint8Array, at: number): number {
  return (
    (((bytes[at] ?? 0) & 0x7f) << 21) |
    (((bytes[at + 1] ?? 0) & 0x7f) << 14) |
    (((bytes[at + 2] ?? 0) & 0x7f) << 7) |
    ((bytes[at + 3] ?? 0) & 0x7f)
  );
}

function bigEndian(bytes: Uint8Array, at: number, length: number): number {
  let value = 0;
  for (let index = 0; index < length; index++) value = value * 256 + (bytes[at + index] ?? 0);
  return value;
}

type Frame = {
  id: string;
  size: number;
  headerBytes: number;
  flags: number;
};

function frameAt(tag: Uint8Array, at: number, major: number): Frame {
  const id = String.fromCharCode(...tag.subarray(at, at + (major === 2 ? 3 : 4)));
  if (major === 2) return { id, size: bigEndian(tag, at + 3, 3), headerBytes: 6, flags: 0 };
  return {
    id,
    size: major === 4 ? syncSafe(tag, at + 4) : bigEndian(tag, at + 4, 4),
    headerBytes: 10,
    flags: tag[at + 9] ?? 0,
  };
}

/** Compression and encryption stay unread, and a frame's own unsynchronisation is undone. Null when it can't be read. */
function frameText(frame: Frame, data: Uint8Array, major: number): string | null {
  if (major === 3) {
    if ((frame.flags & 0xc0) !== 0) return null;
    return decodeText((frame.flags & 0x20) !== 0 ? data.subarray(1) : data);
  }
  if (major === 4) {
    if ((frame.flags & 0x0c) !== 0) return null;
    const unsynced = (frame.flags & 0x02) !== 0 ? removeUnsync(data) : data;
    return decodeText((frame.flags & 0x01) !== 0 ? unsynced.subarray(4) : unsynced);
  }
  return decodeText(data);
}

function tconIn(tag: Uint8Array, major: number, flags: number): string | null {
  const body = major < 4 && (flags & 0x80) !== 0 ? removeUnsync(tag) : tag;
  let at = 0;
  if ((flags & 0x40) !== 0 && major >= 3) {
    at = major === 4 ? syncSafe(body, 0) : bigEndian(body, 0, 4) + 4;
  }

  while (at < body.length && body[at] !== 0) {
    const frame = frameAt(body, at, major);
    const start = at + frame.headerBytes;
    if (frame.id === 'TCON' || frame.id === 'TCO') {
      return frameText(frame, body.subarray(start, start + frame.size), major);
    }
    at = start + frame.size;
  }
  return null;
}

async function readTcon(file: FileHandle): Promise<string | null> {
  const { size: fileSize } = await file.stat();
  const header = Buffer.alloc(ID3_HEADER_BYTES);
  let position = 0;

  // A file can start with more than one tag.
  while (position + ID3_HEADER_BYTES <= fileSize) {
    await file.read(header, 0, ID3_HEADER_BYTES, position);
    if (header.toString('latin1', 0, 3) !== 'ID3') return null;
    const major = header[3] ?? 0;
    const flags = header[5] ?? 0;
    if (major < 2 || major > 4) return null;

    const size = Math.min(syncSafe(header, 6), fileSize - position - ID3_HEADER_BYTES);
    const tag = Buffer.allocUnsafe(size);
    await file.read(tag, 0, size, position + ID3_HEADER_BYTES);
    const text = tconIn(tag, major, flags);
    if (text !== null) return text;

    position += ID3_HEADER_BYTES + size + ((flags & 0x10) !== 0 ? ID3_HEADER_BYTES : 0);
  }
  return null;
}

function hasGenre(tags: ITag[] | undefined): boolean {
  return tags?.some(({ id }) => id.toUpperCase() === 'GENRE') ?? false;
}

/**
 * Null when the genre doesn't come from an ID3v2 frame: `common.genre` already has it right from a block that outranks
 * ID3v2, or from ID3v1.
 */
export async function id3v2Genres(path: string, native: IAudioMetadata['native']): Promise<string[] | null> {
  const hasId3v2 = Object.keys(native).some((block) => block.startsWith('ID3v2'));
  if (!hasId3v2 || hasGenre(native.vorbis) || hasGenre(native.APEv2)) return null;

  try {
    const file = await open(path, 'r');
    try {
      const text = await readTcon(file);
      return text === null ? null : genresFromTcon(text);
    } finally {
      await file.close();
    }
  } catch {
    return null;
  }
}
