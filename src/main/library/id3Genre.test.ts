import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFile } from 'music-metadata';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { genresFromTcon, id3v2Genres } from '@main/library/id3Genre';
import { makeTone, tempDir } from '@main/library/testFixtures';

// Real files and real ffmpeg, on a machine shared with every other test file.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let dir: string;

function syncSafe(size: number): Buffer {
  return Buffer.from([(size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f]);
}

function tag(major: number, frames: Buffer, flags = 0): Buffer {
  return Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.from([major, 0, flags]), syncSafe(frames.length), frames]);
}

function frame(major: number, id: string, data: Buffer, flags = 0): Buffer {
  if (major === 2) {
    const size = Buffer.from([0, (data.length >> 8) & 0xff, data.length & 0xff]);
    return Buffer.concat([Buffer.from(id, 'latin1'), size, data]);
  }
  const size = Buffer.alloc(4);
  if (major === 4) syncSafe(data.length).copy(size);
  else size.writeUInt32BE(data.length);
  return Buffer.concat([Buffer.from(id, 'latin1'), size, Buffer.from([0, flags]), data]);
}

const latin1 = (text: string) => Buffer.concat([Buffer.from([0]), Buffer.from(text, 'latin1')]);
const utf8 = (text: string) => Buffer.concat([Buffer.from([3]), Buffer.from(text, 'utf8')]);
const utf16 = (text: string) => Buffer.concat([Buffer.from([1, 0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
const utf16be = (text: string) => Buffer.concat([Buffer.from([2]), Buffer.from(text, 'utf16le').swap16()]);

function file(name: string, ...parts: Buffer[]): string {
  const path = join(dir, name);
  writeFileSync(path, Buffer.concat(parts));
  return path;
}

const ID3V23 = { 'ID3v2.3': [] };

beforeAll(() => {
  dir = tempDir('id3-genre');
});

describe('genresFromTcon', () => {
  it('leaves words in brackets alone, wherever the bracket is', () => {
    expect(genresFromTcon('Pop (indie)')).toEqual(['Pop (indie)']);
    expect(genresFromTcon('Electro (Pop)')).toEqual(['Electro (Pop)']);
    expect(genresFromTcon('Rock (Alternative) (1990s)')).toEqual(['Rock (Alternative) (1990s)']);
    expect(genresFromTcon('(Pop)')).toEqual(['(Pop)']);
    expect(genresFromTcon('Mix (2009)')).toEqual(['Mix (2009)']);
  });

  it('expands a number in brackets, and only at the start', () => {
    expect(genresFromTcon('(17)')).toEqual(['Rock']);
    expect(genresFromTcon('(51)(39)')).toEqual(['Techno-Industrial', 'Noise']);
    expect(genresFromTcon('(4)Eurodisco')).toEqual(['Disco', 'Eurodisco']);
    expect(genresFromTcon('Pop (17)')).toEqual(['Pop (17)']);
  });

  it('knows the two keywords', () => {
    expect(genresFromTcon('(RX)(CR)')).toEqual(['Remix', 'Cover']);
  });

  it('reads a bare number the way ID3v2.4 writes it', () => {
    expect(genresFromTcon('21')).toEqual(['Ska']);
    expect(genresFromTcon('21\0Eurodisco')).toEqual(['Ska', 'Eurodisco']);
  });

  it('keeps a doubled bracket as one real bracket', () => {
    expect(genresFromTcon('((I can figure out any genre)')).toEqual(['(I can figure out any genre)']);
    expect(genresFromTcon('(55)((I think...)')).toEqual(['Dream', '(I think...)']);
  });

  it('drops a reference to nothing', () => {
    expect(genresFromTcon('(999)')).toEqual([]);
    expect(genresFromTcon('999')).toEqual([]);
    expect(genresFromTcon('(999)Words')).toEqual(['Words']);
  });

  it('splits on NUL, and skips what is empty', () => {
    expect(genresFromTcon('Rock\0Pop (indie)\0')).toEqual(['Rock', 'Pop (indie)']);
    expect(genresFromTcon('')).toEqual([]);
  });

  it('handles a byte order mark on each value', () => {
    expect(genresFromTcon('\uFEFFRock\0\uFEFFPop')).toEqual(['Rock', 'Pop']);
  });
});

describe('id3v2Genres', () => {
  it('reads what ffmpeg wrote into a real MP3, where music-metadata loses it', async () => {
    const path = join(dir, 'real.mp3');
    makeTone(path, { frequency: 440, tags: { title: 'X', genre: 'Electro (Pop)' } });
    const { common, native } = await parseFile(path);
    expect(common.genre).toEqual(['Electro ']);
    expect(await id3v2Genres(path, native)).toEqual(['Electro (Pop)']);
  });

  it.each([
    ['ID3v2.2', 2, 'TCO', latin1('Pop (indie)')],
    ['ID3v2.3 Latin-1', 3, 'TCON', latin1('Pop (indie)')],
    ['ID3v2.3 UTF-16', 3, 'TCON', utf16('Pop (indie)')],
    ['ID3v2.4 UTF-8', 4, 'TCON', utf8('Pop (indie)')],
    ['ID3v2.4 UTF-16 big endian', 4, 'TCON', utf16be('Pop (indie)')],
  ])('reads %s', async (name, major, id, data) => {
    const path = file(`${name}.mp3`, tag(major, frame(major, id, data)), Buffer.alloc(16));
    expect(await id3v2Genres(path, ID3V23)).toEqual(['Pop (indie)']);
  });

  it('skips the frames before it, including a large picture', async () => {
    const picture = frame(3, 'APIC', Buffer.alloc(300_000, 0xff));
    const path = file('after-art.mp3', tag(3, Buffer.concat([picture, frame(3, 'TCON', latin1('Soul (Neo)'))])));
    expect(await id3v2Genres(path, ID3V23)).toEqual(['Soul (Neo)']);
  });

  it('stops at padding, and looks in a second tag', async () => {
    const padded = tag(3, Buffer.concat([frame(3, 'TIT2', latin1('Title')), Buffer.alloc(100)]));
    const second = tag(3, frame(3, 'TCON', latin1('Folk (Dark)')));
    expect(await id3v2Genres(file('second-tag.mp3', padded, second), ID3V23)).toEqual(['Folk (Dark)']);
  });

  it('undoes unsynchronisation, for the whole tag in 2.3 and per frame in 2.4', async () => {
    const whole = frame(3, 'TCON', utf16('Pop (indie)'));
    const unsynced = Buffer.from(whole.toString('latin1').replaceAll('\xff', '\xff\0'), 'latin1');
    expect(await id3v2Genres(file('unsync-23.mp3', tag(3, unsynced, 0x80)), ID3V23)).toEqual(['Pop (indie)']);

    const data = utf16('Pop (indie)');
    const stuffed = Buffer.from(data.toString('latin1').replaceAll('\xff', '\xff\0'), 'latin1');
    const flagged = frame(4, 'TCON', stuffed, 0x02);
    expect(await id3v2Genres(file('unsync-24.mp3', tag(4, flagged)), ID3V23)).toEqual(['Pop (indie)']);
  });

  it('skips an extended header', async () => {
    const extended = Buffer.alloc(10);
    extended.writeUInt32BE(6);
    const body = Buffer.concat([extended, frame(3, 'TCON', latin1('Jazz (Cool)'))]);
    expect(await id3v2Genres(file('extended.mp3', tag(3, body, 0x40)), ID3V23)).toEqual(['Jazz (Cool)']);
  });

  it('leaves a frame it cannot read to music-metadata', async () => {
    const compressed = frame(3, 'TCON', latin1('zzz'), 0x80);
    expect(await id3v2Genres(file('compressed.mp3', tag(3, compressed)), ID3V23)).toBeNull();
  });

  it('leaves a file with no frame, or no tag at the start, to music-metadata', async () => {
    expect(await id3v2Genres(file('no-frame.mp3', tag(3, frame(3, 'TIT2', latin1('T')))), ID3V23)).toBeNull();
    expect(await id3v2Genres(file('no-tag.mp3', Buffer.alloc(100)), ID3V23)).toBeNull();
    expect(await id3v2Genres(file('tiny.mp3', Buffer.from('ID3')), ID3V23)).toBeNull();
  });

  it('survives a tag that claims more than the file holds', async () => {
    const header = Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.from([3, 0, 0, 0x7f, 0x7f, 0x7f, 0x7f])]);
    expect(await id3v2Genres(file('huge.mp3', header, Buffer.alloc(20)), ID3V23)).toBeNull();
  });

  it('leaves the genre to a block that outranks ID3v2, whatever the frame says', async () => {
    const path = file('outranked.mp3', tag(3, frame(3, 'TCON', latin1('Pop (indie)'))));
    const ape = { 'ID3v2.3': [], APEv2: [{ id: 'Genre', value: 'Soundtrack' }] };
    expect(await id3v2Genres(path, ape)).toBeNull();
    expect(await id3v2Genres(path, { 'ID3v2.3': [], vorbis: [{ id: 'GENRE', value: 'Rock' }] })).toBeNull();
    expect(await id3v2Genres(path, { vorbis: [] })).toBeNull();
  });

  it('reads the frame for a FLAC whose Vorbis block has no genre', async () => {
    const path = file('flac-with-id3.flac', tag(3, frame(3, 'TCON', latin1('Pop (indie)'))));
    expect(await id3v2Genres(path, { 'ID3v2.3': [], vorbis: [{ id: 'TITLE', value: 'x' }] })).toEqual(['Pop (indie)']);
  });

  it('is null for a file that has gone', async () => {
    const path = file('going.mp3', Buffer.alloc(4));
    rmSync(path);
    expect(await id3v2Genres(path, ID3V23)).toBeNull();
  });
});
