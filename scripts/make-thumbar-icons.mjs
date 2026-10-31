/*
 * Draws the taskbar thumbnail's buttons into resources/icons/, at each scale Electron picks from by file name. They're
 * committed, so this only runs again to change how they look: node scripts/make-thumbar-icons.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

const OUTPUT = resolve(import.meta.dirname, '..', 'resources', 'icons');
const SCALES = [
  { suffix: '', pixels: 16 },
  { suffix: '@1.5x', pixels: 24 },
  { suffix: '@2x', pixels: 32 },
];
const SUPERSAMPLE = 8;

// Convex polygons on a 16 by 16 grid, clockwise.
const bar = (left, right) => [
  [left, 3],
  [right, 3],
  [right, 13],
  [left, 13],
];

const SHAPES = {
  play: [
    [
      [4, 2.5],
      [13, 8],
      [4, 13.5],
    ],
  ],
  pause: [bar(3.5, 6.5), bar(9.5, 12.5)],
  next: [
    [
      [3, 3],
      [10.5, 8],
      [3, 13],
    ],
    bar(10.5, 13),
  ],
  previous: [
    [
      [13, 13],
      [5.5, 8],
      [13, 3],
    ],
    bar(3, 5.5),
  ],
};

function isInside(polygon, x, y) {
  return polygon.every(([ax, ay], index) => {
    const [bx, by] = polygon[(index + 1) % polygon.length];
    return (bx - ax) * (y - ay) - (by - ay) * (x - ax) >= 0;
  });
}

function coverage(polygons, pixelX, pixelY, pixels) {
  let hits = 0;
  for (let sy = 0; sy < SUPERSAMPLE; sy++) {
    for (let sx = 0; sx < SUPERSAMPLE; sx++) {
      const x = ((pixelX + (sx + 0.5) / SUPERSAMPLE) / pixels) * 16;
      const y = ((pixelY + (sy + 0.5) / SUPERSAMPLE) / pixels) * 16;
      if (polygons.some((polygon) => isInside(polygon, x, y))) hits++;
    }
  }
  return hits / SUPERSAMPLE ** 2;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(polygons, pixels) {
  const rows = Buffer.alloc((pixels * 4 + 1) * pixels);
  let offset = 0;
  for (let y = 0; y < pixels; y++) {
    rows[offset++] = 0;
    for (let x = 0; x < pixels; x++) {
      rows.fill(255, offset, offset + 3);
      rows[offset + 3] = Math.round(coverage(polygons, x, y, pixels) * 255);
      offset += 4;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(pixels, 0);
  header.writeUInt32BE(pixels, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUTPUT, { recursive: true });
for (const [name, polygons] of Object.entries(SHAPES)) {
  for (const { suffix, pixels } of SCALES) {
    writeFileSync(join(OUTPUT, `${name}${suffix}.png`), png(polygons, pixels));
  }
}
