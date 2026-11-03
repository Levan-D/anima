/*
 * Draws the app's icon: a treble clef from Noto Music on a dark gray square. Writes build/icon.ico, which electron-builder
 * puts on the exe and the installer, and resources/icons/app.png for the window. Both are committed, so this only runs
 * again to change how it looks. The font is OFL and isn't in the repo; get it first:
 *
 *   curl -L -o .dev/icon-font/NotoMusic-Regular.ttf https://github.com/google/fonts/raw/main/ofl/notomusic/NotoMusic-Regular.ttf
 *   npx electron scripts/make-app-icon.mjs
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { crc32, deflateSync } from 'node:zlib';
import { app, BrowserWindow } from 'electron';

const ROOT = resolve(import.meta.dirname, '..');
const FONT_DIR = join(ROOT, '.dev', 'icon-font');
const SIZES = [16, 24, 32, 48, 64, 128, 256];
const DRAWN_AT = 1024;

const PAGE = `<!doctype html>
<meta charset="utf-8">
<style>
  @font-face { font-family: 'Noto Music'; src: url('NotoMusic-Regular.ttf'); }
  html, body { margin: 0; width: ${DRAWN_AT}px; height: ${DRAWN_AT}px; background: transparent; overflow: hidden; }
  /* Clear space around the square, as Windows' own icons have, so it doesn't fill the taskbar's slot edge to edge. */
  body { display: flex; align-items: center; justify-content: center; }
  .square {
    width: 84%; height: 84%; border-radius: 22%;
    background: linear-gradient(to bottom, rgb(44 44 48), rgb(14 14 16));
    display: flex; align-items: center; justify-content: center; overflow: hidden;
  }
  /* Stretched a little, since the clef on its own reads as a thin line at taskbar size. */
  .clef {
    font-family: 'Noto Music'; font-size: 400px; line-height: 1; color: white;
    transform: translate(var(--x), var(--y)) scaleX(1.3);
  }
</style>
<div class="square"><span class="clef">\u{1D11E}</span></div>`;

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

function ico(images) {
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

/** Electron's bitmaps are BGRA. */
function rgbaOf(image) {
  const bgra = image.toBitmap();
  for (let i = 0; i < bgra.length; i += 4) [bgra[i], bgra[i + 2]] = [bgra[i + 2], bgra[i]];
  return bgra;
}

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  if (!existsSync(join(FONT_DIR, 'NotoMusic-Regular.ttf'))) {
    console.error(`Noto Music isn't in ${FONT_DIR}. The command to get it is at the top of this script.`);
    app.exit(1);
    return;
  }
  // The clef sits off-center in its own box, so it's nudged to look centered in the square.
  const x = process.env.ICON_X ?? '0px';
  const y = process.env.ICON_Y ?? '0px';
  const pagePath = join(FONT_DIR, 'icon.html');
  writeFileSync(pagePath, PAGE.replace('var(--x), var(--y)', `${x}, ${y}`));

  const win = new BrowserWindow({
    width: DRAWN_AT,
    height: DRAWN_AT,
    useContentSize: true,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true },
  });
  await win.loadFile(pagePath);
  await win.webContents.executeJavaScript(
    'document.fonts.ready.then(() => document.fonts.check("400px \\"Noto Music\\""))',
  );
  await wait(300);
  const drawn = await win.webContents.capturePage();

  const images = SIZES.map((size) => {
    const rgba = rgbaOf(drawn.resize({ width: size, height: size, quality: 'best' }));
    return { size, rgba, data: size === 256 ? png(rgba, size) : bitmap(rgba, size) };
  });
  mkdirSync(join(ROOT, 'build'), { recursive: true });
  writeFileSync(join(ROOT, 'build', 'icon.ico'), ico(images));
  const big = images.find(({ size }) => size === 256);
  writeFileSync(join(ROOT, 'resources', 'icons', 'app.png'), png(big.rgba, 256));
  writeFileSync(join(FONT_DIR, 'preview-1024.png'), drawn.toPNG());
  console.log('Wrote build/icon.ico and resources/icons/app.png');
  app.exit(0);
});
