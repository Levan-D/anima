import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { imageSize, readImageSize } from '@main/library/imageSize';
import { makeImage, tempDir } from '@main/library/testFixtures';

describe('readImageSize', () => {
  let dir: string;

  beforeAll(() => {
    dir = tempDir('image-size');
  });

  it.each(['png', 'jpg', 'bmp', 'gif', 'webp'])('reads a real %s', async (extension) => {
    const path = join(dir, `cover.${extension}`);
    makeImage(path, 'teal', '640x360');
    expect(await readImageSize(path)).toEqual({ width: 640, height: 360 });
  });

  it('has no answer for a file that is not there', async () => {
    expect(await readImageSize(join(dir, 'gone.png'))).toBeNull();
  });
});

describe('imageSize', () => {
  it('walks past what a JPEG holds ahead of its size', () => {
    const comment = Buffer.from([0xff, 0xfe, 0x00, 0x04, 0x61, 0x62]);
    const frame = Buffer.from([0xff, 0xc2, 0x00, 0x11, 0x08, 0x01, 0xf4, 0x02, 0x58, 0x03, 0, 0, 0, 0, 0, 0]);
    expect(imageSize(Buffer.concat([Buffer.from([0xff, 0xd8]), comment, frame]))).toEqual({ width: 600, height: 500 });
  });

  it('says nothing about what is not an image', () => {
    expect(imageSize(Buffer.from('not an image at all, just some words'))).toBeNull();
  });
});
