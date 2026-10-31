/*
 * Draws the app's icon into build/icon.ico, which electron-builder puts on the exe and the installer. It's committed,
 * so this only runs again to change how it looks: node scripts/make-app-icon.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

const OUTPUT = resolve(import.meta.dirname, '..', 'build');
const SIZES = [16, 24, 32, 48, 64, 128, 256];
const SUPERSAMPLE = 6;

const TOP = [58, 42, 110];
const BOTTOM = [14, 12, 30];
const WHITE = [255, 255, 255];

// On a grid from 0 to 1, clockwise.
const PLAY = [
  [0.385, 0.27],
  [0.76, 0.5],
  [0.385, 0.73],
];
const CORNER = 0.22;

function isInRoundedSquare(x, y) {
  const dx = Math.max(CORNER - x, x - (1 - CORNER), 0);
  const dy = Math.max(CORNER - y, y - (1 - CORNER), 0);
  return dx * dx + dy * dy <= CORNER * CORNER;
}

function isInPlay(x, y) {
  return PLAY.every(([ax, ay], index) => {
    const [bx, by] = PLAY[(index + 1) % PLAY.length];
    return (bx - ax) * (y - ay) - (by - ay) * (x - ax) >= 0;
  });
}

function mix(from, to, amount) {
  return from.map((value, index) => value + (to[index] - value) * amount);
}

/** Top-down RGBA. */
function draw(size) {
  const pixels = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let inside = 0;
      let glyph = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const x = (px + (sx + 0.5) / SUPERSAMPLE) / size;
          const y = (py + (sy + 0.5) / SUPERSAMPLE) / size;
          if (!isInRoundedSquare(x, y)) continue;
          inside++;
          if (isInPlay(x, y)) glyph++;
        }
      }
      if (inside === 0) continue;

      const background = mix(TOP, BOTTOM, (py + 0.5) / size);
      const color = mix(background, WHITE, glyph / inside);
      const offset = (py * size + px) * 4;
      pixels[offset] = Math.round(color[0]);
      pixels[offset + 1] = Math.round(color[1]);
      pixels[offset + 2] = Math.round(color[2]);
      pixels[offset + 3] = Math.round((inside / SUPERSAMPLE ** 2) * 255);
    }
  }
  return pixels;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(rgba, size) {
  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A bottom-up BGRA bitmap with an empty AND mask. Small sizes use this, since not every reader takes PNG below 256. */
function bitmap(rgba, size) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);

  const colors = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const from = (y * size + x) * 4;
      const to = ((size - 1 - y) * size + x) * 4;
      colors[to] = rgba[from + 2];
      colors[to + 1] = rgba[from + 1];
      colors[to + 2] = rgba[from];
      colors[to + 3] = rgba[from + 3];
    }
  }
  const maskRowBytes = Math.ceil(size / 32) * 4;
  return Buffer.concat([header, colors, Buffer.alloc(maskRowBytes * size)]);
}

function ico(sizes) {
  const images = sizes.map((size) => {
    const rgba = draw(size);
    return { size, data: size === 256 ? png(rgba, size) : bitmap(rgba, size) };
  });

  const directory = Buffer.alloc(6 + images.length * 16);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(images.length, 4);
  let offset = directory.length;
  images.forEach(({ size, data }, index) => {
    const entry = 6 + index * 16;
    directory[entry] = size % 256;
    directory[entry + 1] = size % 256;
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(data.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([directory, ...images.map(({ data }) => data)]);
}

mkdirSync(OUTPUT, { recursive: true });
writeFileSync(join(OUTPUT, 'icon.ico'), ico(SIZES));
