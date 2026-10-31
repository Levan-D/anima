/*
 * The waveform through the whole app and the real worker, on generated audio that actually has a shape.
 * Screenshots go to .dev/screenshots/waveform/.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import type { PlayerPosition, ScanState, Track, WaveformData } from '@shared/domain';
import { launchApp, resizeWindow, ROOT, settled, stubFolderDialog } from './helpers/app';

const E2E = join(ROOT, '.dev', 'e2e-waveform');
const MUSIC = join(E2E, 'Music');
const SCREENSHOTS = join(ROOT, '.dev', 'screenshots', 'waveform');
const FFMPEG = join(ROOT, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe');

const SECONDS = 180;
const LOUD_AND_QUIET = `sin(440*2*PI*t)*(0.1+0.8*pow(abs(sin(t/3)*sin(t/11)),2)+0.1*abs(sin(t*2)))`;

let app: ElectronApplication;
let page: Page;
let tracks: Track[];

function makeTrack(name: string, title: string): void {
  execFileSync(
    FFMPEG,
    [
      ...['-y', '-hide_banner', '-loglevel', 'error', '-nostdin', '-f', 'lavfi'],
      ...['-i', `aevalsrc='${LOUD_AND_QUIET}':s=44100:d=${SECONDS}`],
      ...['-metadata', `title=${title}`, '-metadata', 'artist=Generated', '-metadata', 'album=Waveforms'],
      join(MUSIC, name),
    ],
    { windowsHide: true, stdio: 'ignore' },
  );
}

async function value<T>(name: string, input?: unknown): Promise<T> {
  const result = (await page.evaluate(
    ([command, args]) =>
      (window.api.invoke as (...values: unknown[]) => Promise<unknown>)(command, ...(args === undefined ? [] : [args])),
    [name, input] as const,
  )) as { ok: true; value: T } | { ok: false; error: { message: string } };
  if (!result.ok) throw new Error(`${name}: ${result.error.message}`);
  return result.value;
}

function trackTitled(title: string): Track {
  const track = tracks.find((candidate) => candidate.title === title);
  if (!track) throw new Error(`No track called ${title}`);
  return track;
}

const waveform = () => page.getByTestId('waveform');
const line = () => page.getByTestId('seekbar').locator('[data-slot="fill"]').locator('..');
const opacity = (of: ReturnType<Page['locator']>) =>
  of.evaluate((element) => Number(getComputedStyle(element).opacity));

function playedFraction(): Promise<number> {
  return waveform()
    .locator('[data-slot="played"]')
    .evaluate((played) => {
      const right = /inset\(0(?:px)? ([\d.]+)%/.exec(played.style.clipPath)?.[1];
      return 1 - Number(right) / 100;
    });
}

async function play(title: string): Promise<void> {
  await value('player.play', { trackIds: [trackTitled(title).id], startIndex: 0 });
}

async function expectBars(): Promise<void> {
  await expect(waveform()).toHaveAttribute('data-has-peaks', 'true', { timeout: 30_000 });
  await expect.poll(() => opacity(waveform())).toBe(1);
  await expect.poll(() => opacity(line())).toBe(0);
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  rmSync(E2E, { recursive: true, force: true });
  mkdirSync(MUSIC, { recursive: true });
  mkdirSync(SCREENSHOTS, { recursive: true });
  makeTrack('one.flac', 'One');
  makeTrack('two.mp3', 'Two');
  makeTrack('three.flac', 'Three');
  makeTrack('corrupt.flac', 'Corrupt');

  app = await launchApp({ userData: join(E2E, 'user-data'), dataRoot: join(E2E, 'data') });
  page = await app.firstWindow();
  await page.waitForLoadState('load');
  await resizeWindow(app, page, 1280, 800);
  await stubFolderDialog(app, MUSIC);
  await page.getByRole('button', { name: 'Choose a folder' }).click();
  await page.getByRole('tab', { name: 'Albums', exact: true }).waitFor();
  await expect
    .poll(async () => (await value<ScanState>('scan.state')).phase, { timeout: 60_000, intervals: [100] })
    .toBe('idle');
  tracks = await value<Track[]>('library.tracks', { filter: { kind: 'all' } });
});

test.afterAll(async () => {
  await app.close();
});

test('bars take over from the line without moving anything, and the whole track gets its peaks', async () => {
  const before = await page.getByTestId('seekbar').boundingBox();
  await play('One');
  await expectBars();
  expect(await page.getByTestId('seekbar').boundingBox()).toEqual(before);
  expect(before?.height).toBeGreaterThanOrEqual(44);

  const data = await value<WaveformData>('waveform.get', { trackId: trackTitled('One').id });
  expect(data.peaks.length).toBe(2000);
  expect(Math.max(...data.peaks)).toBeGreaterThan(150);
  expect(Math.min(...data.peaks)).toBeLessThan(100);
  await expect(waveform().locator('[data-slot="played"]')).toHaveCSS('mask-image', /^url\("data:image\/png/);
});

test('a click seeks, a drag holds, and the bars follow both', async () => {
  const box = await page.getByRole('slider', { name: 'Seek' }).locator('../..').boundingBox();
  const bar = box ?? { x: 0, y: 0, width: 0, height: 0 };
  const y = bar.y + 12;

  await page.mouse.click(bar.x + bar.width * 0.5, y);
  await expect
    .poll(async () => Math.abs((await value<PlayerPosition>('player.position')).positionMs / (SECONDS * 1000) - 0.5))
    .toBeLessThan(0.02);
  await expect.poll(async () => Math.abs((await playedFraction()) - 0.5)).toBeLessThan(0.02);

  await page.mouse.move(bar.x + bar.width * 0.25, y);
  await page.mouse.down();
  await page.mouse.move(bar.x + bar.width * 0.75, y);
  expect(Math.abs((await playedFraction()) - 0.75)).toBeLessThan(0.01);
  await page.mouse.up();
  await expect
    .poll(async () => Math.abs((await value<PlayerPosition>('player.position')).positionMs / (SECONDS * 1000) - 0.75))
    .toBeLessThan(0.02);
});

test('moves in the position steps while it plays, and writes nothing while paused', async () => {
  const writes = () =>
    page.evaluate(async () => {
      const played = document.querySelector('[data-testid="waveform"] [data-slot="played"]');
      if (!played) return -1;
      let count = 0;
      const observer = new MutationObserver((records) => (count += records.length));
      observer.observe(played, { attributes: true });
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      observer.disconnect();
      return count;
    });

  const playing = await writes();
  expect(playing).toBeGreaterThanOrEqual(2);
  expect(playing).toBeLessThanOrEqual(2 * 5);

  await value('player.pause');
  await page.waitForTimeout(300);
  expect(await writes()).toBe(0);
});

test('one pass of screenshots, with the layouts the transport can take', async () => {
  await value('player.seek', { positionMs: SECONDS * 400 });
  for (const [width, height] of [
    [1280, 800],
    [1920, 1080],
    [3840, 2160],
    [1000, 560],
    [640, 900],
  ] as const) {
    await resizeWindow(app, page, width, height);
    // The mask waits for a resize to settle.
    await page.waitForTimeout(300);
    await settled(page);
    const bar = await page.getByRole('slider', { name: 'Seek' }).boundingBox();
    expect(bar).not.toBeNull();
    const seekbar = await page.getByTestId('seekbar').boundingBox();
    expect(seekbar?.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: join(SCREENSHOTS, `waveform-${width}x${height}.png`) });
    await page.getByTestId('transport').screenshot({ path: join(SCREENSHOTS, `transport-${width}x${height}.png`) });
  }
  await resizeWindow(app, page, 1280, 800);
});

test('a corrupt file leaves the line', async () => {
  writeFileSync(join(MUSIC, 'corrupt.flac'), Buffer.alloc(4096, 0x5a));
  const corrupt = trackTitled('Corrupt');
  expect(await value('waveform.get', { trackId: corrupt.id })).toBeNull();

  await play('Corrupt');
  await page.waitForTimeout(1_500);
  await expect(waveform()).toHaveAttribute('data-has-peaks', 'false');
  await expect.poll(() => opacity(waveform())).toBe(0);
  await expect.poll(() => opacity(line())).toBe(1);
});

test('the next track is ready before it plays', async () => {
  await value('player.play', { trackIds: [trackTitled('Two').id, trackTitled('Three').id], startIndex: 0 });
  await expectBars();
  await expect
    .poll(
      async () => {
        const started = Date.now();
        const data = await value<WaveformData | null>('waveform.get', { trackId: trackTitled('Three').id });
        return data !== null && Date.now() - started < 200;
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  await value('player.next');
  await expectBars();
});
