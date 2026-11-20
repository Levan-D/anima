/*
 * Draws the app's icon, a Bodoni Moda italic "a" on a near-black square, and the "anima" wordmark with its pink "i".
 * Writes build/icon.ico, which electron-builder puts on the exe and the installer, resources/icons/app.png for the
 * window, and docs/brand/ for the README. All are committed, so this only runs again to change how they look. The
 * font is OFL and isn't in the repo; get it first:
 *
 *   curl -L -o .dev/icon-font/BodoniModa-Italic.ttf "https://github.com/google/fonts/raw/main/ofl/bodonimoda/BodoniModa-Italic%5Bopsz,wght%5D.ttf"
 *   npx electron scripts/make-app-icon.mjs
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { crc32, deflateSync } from 'node:zlib';
import { app, BrowserWindow } from 'electron';

const ROOT = resolve(import.meta.dirname, '..');
const FONT_DIR = join(ROOT, '.dev', 'icon-font');
const FONT_FILE = 'BodoniModa-Italic.ttf';
const DRAWN_AT = 1024;

const TILE = '#141414';
const CREAM = '#efe7dc';
const INK = '#1a1715';
const PINK_ON_DARK = '#e8788a';
const PINK_ON_LIGHT = '#c9566a';

/*
 * Each range of sizes gets its own cut of the "a". The optical size axis thickens Bodoni's hairlines, which vanish
 * below about 20 pixels at the display cut. The small sizes drop the clear space around the square, having none to
 * spare. At 16 the weight goes back down: any heavier and the bowl's counter fills in, and it stops reading as an a.
 */
const CUTS = [
  { name: 'large', sizes: [128, 256], opsz: 72, weight: 700, square: 0.94, letter: 0.5 },
  { name: 'medium', sizes: [48, 64], opsz: 24, weight: 720, square: 0.94, letter: 0.52 },
  { name: 'small', sizes: [24, 32], opsz: 6, weight: 800, square: 1, letter: 0.58 },
  { name: 'tiny', sizes: [16], opsz: 6, weight: 640, square: 1, letter: 0.66 },
];

const WORDMARKS = [
  { file: 'anima-on-dark.png', text: CREAM, accent: PINK_ON_DARK },
  { file: 'anima-on-light.png', text: INK, accent: PINK_ON_LIGHT },
];

const PAGE = `<!doctype html>
<meta charset="utf-8">
<style>
  @font-face { font-family: 'Bodoni Moda'; src: url('${FONT_FILE}'); font-style: italic; font-weight: 400 900; }
  html, body { margin: 0; width: ${DRAWN_AT}px; height: ${DRAWN_AT}px; background: transparent; overflow: hidden; }
  span { position: absolute; font-family: 'Bodoni Moda'; font-style: italic; line-height: 1; white-space: nowrap; }
</style>
<body></body>`;

const MEASURE_AT = { left: 200, top: 100, fontSize: 600 };

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

/** Where the drawn pixels are. A glyph's own box says nothing about its ink, least of all an italic's. */
function inkBox(image) {
  const { width, height } = image.getSize();
  const pixels = image.toBitmap();
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] < 8) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < 0) throw new Error('Nothing was drawn. Is the font in place?');
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

const variation = (opsz, weight) => `font-variation-settings: 'opsz' ${opsz}, 'wght' ${weight}`;
const wordmarkText = (accent) => `an<b style="font-weight: inherit; color: ${accent}">i</b>ma`;

async function draw(win, html) {
  await win.webContents.executeJavaScript(
    `document.body.innerHTML = ${JSON.stringify(html)}; document.fonts.ready.then(() => true)`,
  );
  await wait(300);
  return win.webContents.capturePage();
}

/** Measures the ink at a known spot, then scales and moves it so its ink is centered at the given size. */
async function placed(win, inner, style, inkHeight) {
  const at = MEASURE_AT;
  const measured = inkBox(
    await draw(
      win,
      `<span style="left: ${at.left}px; top: ${at.top}px; font-size: ${at.fontSize}px; ${style}">${inner}</span>`,
    ),
  );
  const scale = inkHeight / measured.height;
  const centerX = (measured.left + measured.width / 2 - at.left) * scale;
  const centerY = (measured.top + measured.height / 2 - at.top) * scale;
  const left = DRAWN_AT / 2 - centerX;
  const top = DRAWN_AT / 2 - centerY;
  return `<span style="left: ${left}px; top: ${top}px; font-size: ${at.fontSize * scale}px; ${style}">${inner}</span>`;
}

async function drawCut(win, cut) {
  const side = DRAWN_AT * cut.square;
  const inset = (DRAWN_AT - side) / 2;
  const letter = await placed(win, 'a', `color: ${CREAM}; ${variation(cut.opsz, cut.weight)}`, side * cut.letter);
  const square = `<div style="position: absolute; left: ${inset}px; top: ${inset}px; width: ${side}px; height: ${side}px; border-radius: 22%; background: ${TILE}"></div>`;
  return draw(win, square + letter);
}

async function drawWordmark(win, { text, accent }) {
  const style = `color: ${text}; ${variation(28, 700)}`;
  const drawn = await draw(win, await placed(win, wordmarkText(accent), style, 180));
  const ink = inkBox(drawn);
  const margin = 12;
  return drawn.crop({
    x: ink.left - margin,
    y: ink.top - margin,
    width: ink.width + margin * 2,
    height: ink.height + margin * 2,
  });
}

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  if (!existsSync(join(FONT_DIR, FONT_FILE))) {
    console.error(`Bodoni Moda isn't in ${FONT_DIR}. The command to get it is at the top of this script.`);
    app.exit(1);
    return;
  }
  const pagePath = join(FONT_DIR, 'icon.html');
  writeFileSync(pagePath, PAGE);
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

  const images = [];
  for (const cut of CUTS) {
    const drawn = await drawCut(win, cut);
    writeFileSync(join(FONT_DIR, `preview-${cut.name}.png`), drawn.toPNG());
    for (const size of cut.sizes) {
      const rgba = rgbaOf(drawn.resize({ width: size, height: size, quality: 'best' }));
      writeFileSync(join(FONT_DIR, `preview-${size}.png`), png(rgba, size));
      images.push({ size, rgba, data: size === 256 ? png(rgba, size) : bitmap(rgba, size) });
    }
  }
  images.sort((a, b) => a.size - b.size);
  mkdirSync(join(ROOT, 'build'), { recursive: true });
  writeFileSync(join(ROOT, 'build', 'icon.ico'), ico(images));
  const big = images.find(({ size }) => size === 256);
  writeFileSync(join(ROOT, 'resources', 'icons', 'app.png'), png(big.rgba, 256));

  mkdirSync(join(ROOT, 'docs', 'brand'), { recursive: true });
  for (const wordmark of WORDMARKS) {
    writeFileSync(join(ROOT, 'docs', 'brand', wordmark.file), (await drawWordmark(win, wordmark)).toPNG());
  }
  console.log('Wrote build/icon.ico, resources/icons/app.png and docs/brand/');
  app.exit(0);
});
