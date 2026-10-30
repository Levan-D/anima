import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { audioHash } from '@main/library/audioHash';
import { ffmpeg, makeImage, makeTone, tempDir } from '@main/library/testFixtures';

// Real files and real ffmpeg, on a machine shared with every other test file.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let dir: string;
let mp3Frames: Buffer;

const OTHER_TAGS = ['-map_metadata', '-1', '-metadata', 'title=Another title', '-metadata', 'artist=Another artist'];

function id3v2(size: number, version = 3): Buffer {
  const header = Buffer.alloc(10);
  header.write('ID3', 0, 'latin1');
  header[3] = version;
  header[6] = (size >> 21) & 0x7f;
  header[7] = (size >> 14) & 0x7f;
  header[8] = (size >> 7) & 0x7f;
  header[9] = size & 0x7f;
  return Buffer.concat([header, Buffer.alloc(size, 0x41)]);
}

function id3v1(): Buffer {
  const tag = Buffer.alloc(128, 0x20);
  tag.write('TAG', 0, 'latin1');
  return tag;
}

function apeTag(bodyBytes: number, hasHeader: boolean): Buffer {
  const footer = Buffer.alloc(32);
  footer.write('APETAGEX', 0, 'latin1');
  footer.writeUInt32LE(2000, 8);
  footer.writeUInt32LE(bodyBytes + 32, 12);
  footer.writeUInt32LE(1, 16);
  footer.writeUInt32LE(hasHeader ? 0x80000000 : 0, 20);
  const parts = [Buffer.alloc(bodyBytes, 0x42), footer];
  if (hasHeader) parts.unshift(footer);
  return Buffer.concat(parts);
}

function write(name: string, ...parts: Buffer[]): string {
  const path = join(dir, name);
  writeFileSync(path, Buffer.concat(parts));
  return path;
}

beforeAll(() => {
  dir = tempDir('audio-hash');
  mkdirSync(dir, { recursive: true });
  const raw = join(dir, 'raw.mp3');
  ffmpeg(
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=500:duration=0.5',
    '-id3v2_version',
    '0',
    '-write_id3v1',
    '0',
    '-write_xing',
    '0',
    raw,
  );
  mp3Frames = readFileSync(raw);
});

describe('audioHash on MP3', () => {
  it('hashes the frames, whatever tags surround them', async () => {
    const bare = await audioHash(write('bare.mp3', mp3Frames));
    expect(bare).toMatch(/^frames:[0-9a-f]{40}$/);

    const variants = [
      write('id3v2.mp3', id3v2(100), mp3Frames),
      write('bigger-id3v2.mp3', id3v2(5000), mp3Frames),
      write('id3v1.mp3', mp3Frames, id3v1()),
      write('ape.mp3', mp3Frames, apeTag(300, false)),
      write('ape-with-header.mp3', mp3Frames, apeTag(300, true)),
      write('ape-then-id3v1.mp3', mp3Frames, apeTag(50, true), id3v1()),
      write('id3v1-then-ape.mp3', mp3Frames, id3v1(), apeTag(50, false)),
      write('everything.mp3', id3v2(1000), mp3Frames, apeTag(70, true), id3v1()),
      write('padded.mp3', id3v2(100), Buffer.alloc(4096), mp3Frames),
      write('two-tags.mp3', id3v2(100), id3v2(200), mp3Frames),
    ];
    for (const variant of variants) {
      expect(await audioHash(variant), variant).toBe(bare);
    }
  });

  it('gives different audio a different hash', async () => {
    const other = Buffer.from(mp3Frames);
    other[other.length - 1] = (other.at(-1) ?? 0) ^ 0xff;
    expect(await audioHash(write('other.mp3', other))).not.toBe(await audioHash(write('same.mp3', mp3Frames)));
  });

  it('does not let a damaged tag swallow the audio', async () => {
    const claimsTooMuch = Buffer.from(id3v2(0));
    claimsTooMuch.fill(0x7f, 6, 10);
    const one = write('huge-id3-one.mp3', claimsTooMuch, Buffer.from('one'));
    const other = write('huge-id3-other.mp3', claimsTooMuch, Buffer.from('other'));
    expect(await audioHash(one)).toMatch(/^file:/);
    expect(await audioHash(one)).not.toBe(await audioHash(other));
  });

  it('does not trust an APE footer that claims more than the file holds', async () => {
    const footer = Buffer.from(apeTag(0, false));
    footer.writeUInt32LE(4_000_000_000, 12);
    const damaged = write('huge-ape.mp3', mp3Frames, footer);
    expect(await audioHash(damaged)).toMatch(/^frames:/);
    expect(await audioHash(damaged)).not.toBe(await audioHash(write('bare-2.mp3', mp3Frames)));
  });

  it.each([0, 1, 31])('does not get stuck on an APE footer that claims only %i bytes', async (claimed) => {
    const footer = Buffer.from(apeTag(0, false));
    footer.writeUInt32LE(claimed, 12);
    const damaged = write(`small-ape-${claimed}.mp3`, mp3Frames, footer);
    expect(await audioHash(damaged)).toMatch(/^frames:/);
  });

  it('can be cancelled part way through a file', async () => {
    const big = write('big.mp3', mp3Frames, Buffer.alloc(3 * 1024 * 1024, 0x55));
    let looks = 0;
    expect(await audioHash(big, () => ++looks > 1)).toBeNull();
    expect(looks).toBe(2);
    expect(await audioHash(big)).toMatch(/^frames:/);
  });

  it('holds for a real retag with ffmpeg', async () => {
    const tagged = join(dir, 'tagged.mp3');
    const retagged = join(dir, 'retagged.mp3');
    // No Xing frame: ffmpeg writes a new one on every remux, which is more than a tagger would touch.
    const noXing = ['-write_xing', '0'];
    ffmpeg('-f', 'lavfi', '-i', 'sine=frequency=640:duration=0.5', ...noXing, '-metadata', 'title=Original', tagged);
    ffmpeg('-i', tagged, '-c', 'copy', ...noXing, '-id3v2_version', '4', '-write_apetag', '1', ...OTHER_TAGS, retagged);
    expect(await audioHash(retagged)).toBe(await audioHash(tagged));
  });

  it('does not count embedded art as audio', async () => {
    const cover = join(dir, 'cover.png');
    makeImage(cover, 'purple');
    const plain = join(dir, 'plain.mp3');
    const withArt = join(dir, 'with-art.mp3');
    ffmpeg('-f', 'lavfi', '-i', 'sine=frequency=700:duration=0.5', '-write_xing', '0', plain);
    ffmpeg(
      '-i',
      plain,
      '-i',
      cover,
      '-map',
      '0',
      '-map',
      '1',
      '-c',
      'copy',
      '-write_xing',
      '0',
      '-id3v2_version',
      '3',
      '-disposition:v',
      'attached_pic',
      withArt,
    );
    expect(await audioHash(withArt)).toBe(await audioHash(plain));
  });
});

describe('audioHash on FLAC', () => {
  it('reads the MD5 from the header', async () => {
    const path = join(dir, 'tone.flac');
    makeTone(path, { frequency: 800 });
    const hash = await audioHash(path);
    expect(hash).toMatch(/^flac-md5:[0-9a-f]{32}$/);
    expect(hash).not.toBe(`flac-md5:${'0'.repeat(32)}`);
  });

  it('is the same after retagging, with art or without', async () => {
    const cover = join(dir, 'cover2.png');
    makeImage(cover, 'orange');
    const path = join(dir, 'original.flac');
    const retagged = join(dir, 'retagged.flac');
    const withArt = join(dir, 'with-art.flac');
    makeTone(path, { frequency: 900, tags: { title: 'Original' } });
    ffmpeg('-i', path, '-c', 'copy', ...OTHER_TAGS, retagged);
    ffmpeg('-i', path, '-i', cover, '-map', '0', '-map', '1', '-c', 'copy', '-disposition:v', 'attached_pic', withArt);
    const hash = await audioHash(path);
    expect(await audioHash(retagged)).toBe(hash);
    expect(await audioHash(withArt)).toBe(hash);
  });

  it('differs for different audio', async () => {
    const one = join(dir, 'one.flac');
    const two = join(dir, 'two.flac');
    makeTone(one, { frequency: 1000 });
    makeTone(two, { frequency: 1100 });
    expect(await audioHash(one)).not.toBe(await audioHash(two));
  });

  it('looks past an ID3v2 tag in front of the FLAC', async () => {
    const path = join(dir, 'plain.flac');
    makeTone(path, { frequency: 1200 });
    const bytes = readFileSync(path);
    expect(await audioHash(write('id3-first.flac', id3v2(500), bytes))).toBe(await audioHash(path));
  });

  describe('with no MD5 in the header', () => {
    function withoutMd5(path: string): Buffer {
      const bytes = Buffer.from(readFileSync(path));
      bytes.fill(0, 4 + 4 + 18, 4 + 4 + 18 + 16);
      return bytes;
    }

    it('hashes the frames after the metadata blocks instead', async () => {
      const path = join(dir, 'md5-source.flac');
      makeTone(path, { frequency: 1300, tags: { title: 'Some title' } });
      const noMd5 = write('no-md5.flac', withoutMd5(path));
      expect(await audioHash(noMd5)).toMatch(/^frames:[0-9a-f]{40}$/);
    });

    it('still ignores tags', async () => {
      const path = join(dir, 'md5-source-2.flac');
      makeTone(path, { frequency: 1400, tags: { title: 'Some title' } });
      const noMd5 = write('no-md5-2.flac', withoutMd5(path));
      const retagged = join(dir, 'no-md5-retagged.flac');
      ffmpeg('-i', noMd5, '-c', 'copy', ...OTHER_TAGS, retagged);
      const hash = await audioHash(noMd5);
      expect(hash).toMatch(/^frames:/);
      expect(await audioHash(retagged)).toBe(hash);
    });

    it('does not get stuck on an APE footer that claims nothing', async () => {
      const path = join(dir, 'md5-source-3.flac');
      makeTone(path, { frequency: 1450 });
      const footer = Buffer.from(apeTag(0, false));
      footer.writeUInt32LE(0, 12);
      const damaged = write('no-md5-small-ape.flac', withoutMd5(path), footer);
      expect(await audioHash(damaged)).toMatch(/^frames:/);
    });

    it('can be cancelled, without falling back to hashing the whole file', async () => {
      const path = join(dir, 'md5-source-4.flac');
      makeTone(path, { frequency: 1470 });
      expect(await audioHash(write('no-md5-cancelled.flac', withoutMd5(path)), () => true)).toBeNull();
    });
  });

  it('falls back to the whole file for something that only claims to be FLAC', async () => {
    const hash = await audioHash(write('fake.flac', Buffer.from('this is not a flac file')));
    expect(hash).toMatch(/^file:[0-9a-f]{40}$/);
  });
});

describe('audioHash on other formats', () => {
  it('hashes the whole file', async () => {
    const path = join(dir, 'tone.wav');
    makeTone(path, { frequency: 1500 });
    const copy = join(dir, 'copy.wav');
    copyFileSync(path, copy);
    const hash = await audioHash(path);
    expect(hash).toMatch(/^file:[0-9a-f]{40}$/);
    expect(await audioHash(copy)).toBe(hash);
  });

  it('is null for a file that is not there', async () => {
    expect(await audioHash(join(dir, 'nope.mp3'))).toBeNull();
    expect(await audioHash(join(dir, 'nope.flac'))).toBeNull();
    expect(await audioHash(join(dir, 'nope.ogg'))).toBeNull();
  });

  it('copes with tiny files', async () => {
    expect(await audioHash(write('tiny.mp3', Buffer.from([1, 2, 3])))).toMatch(/^frames:/);
    expect(await audioHash(write('tiny.flac', Buffer.from([1, 2, 3])))).toMatch(/^file:/);
    expect(await audioHash(write('empty.mp3', Buffer.alloc(0)))).toMatch(/^frames:/);
  });
});
