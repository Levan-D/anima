/*
 * A generated CUE album through the whole app with --ao=null: browsed, played across a boundary, and counted.
 * The Stats screenshot goes to .dev/screenshots/stats/.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import type { PlayerState, ScanState, StatsSummary, Track, WaveformData } from '@shared/domain';
import { launchApp, resizeWindow, ROOT, settled, stubFolderDialog } from './helpers/app';

const E2E = join(ROOT, '.dev', 'e2e-cue-stats');
const MUSIC = join(E2E, 'Music');
const SCREENSHOTS = join(ROOT, '.dev', 'screenshots', 'stats');
const FFMPEG = join(ROOT, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe');

const SHEET = `PERFORMER "Cue Band"
TITLE "Cue Album"
FILE "album.flac" WAVE
  TRACK 01 AUDIO
    TITLE "First Part"
    INDEX 01 00:00:00
  TRACK 02 AUDIO
    TITLE "Second Part"
    INDEX 01 00:04:00
  TRACK 03 AUDIO
    TITLE "Third Part"
    INDEX 01 00:10:00
`;

let app: ElectronApplication;
let page: Page;
let tracks: Track[];

async function value<T>(name: string, input?: unknown): Promise<T> {
  const result = (await page.evaluate(
    ([command, args]) =>
      (window.api.invoke as (...values: unknown[]) => Promise<unknown>)(command, ...(args === undefined ? [] : [args])),
    [name, input] as const,
  )) as { ok: true; value: T } | { ok: false; error: { message: string } };
  if (!result.ok) throw new Error(`${name}: ${result.error.message}`);
  return result.value;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  rmSync(E2E, { recursive: true, force: true });
  mkdirSync(MUSIC, { recursive: true });
  mkdirSync(SCREENSHOTS, { recursive: true });
  execFileSync(
    FFMPEG,
    [
      ...['-y', '-hide_banner', '-loglevel', 'error', '-nostdin', '-f', 'lavfi'],
      ...['-i', 'sine=frequency=330:duration=20'],
      join(MUSIC, 'album.flac'),
    ],
    { windowsHide: true, stdio: 'ignore' },
  );
  writeFileSync(join(MUSIC, 'album.cue'), SHEET);

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

test('the empty state comes first, and Back returns to Settings', async () => {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Listening stats' }).click();
  await expect(page.getByText('Nothing played yet')).toBeVisible();
  await expect(page.getByText('3 tracks')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Albums', exact: true }).click();
});

test('the album browses as three tracks of one file', async () => {
  expect(
    tracks.map(({ title, artist, album, isCueTrack, durationMs }) => [title, artist, album, isCueTrack, durationMs]),
  ).toEqual([
    ['First Part', 'Cue Band', 'Cue Album', true, 4_000],
    ['Second Part', 'Cue Band', 'Cue Album', true, 6_000],
    ['Third Part', 'Cue Band', 'Cue Album', true, 10_000],
  ]);
  await expect(page.getByText('Cue Album').first()).toBeVisible();
});

test('it plays across a boundary, and a waveform covers each track alone', async () => {
  const ids = tracks.map(({ id }) => id);
  await value('player.play', { trackIds: ids, startIndex: 0 });
  await expect
    .poll(async () => (await value<PlayerState>('player.state')).current?.title, { timeout: 15_000 })
    .toBe('Second Part');

  const first = await value<WaveformData>('waveform.get', { trackId: ids[0] });
  const third = await value<WaveformData>('waveform.get', { trackId: ids[2] });
  expect(third.peaks.length / first.peaks.length).toBeCloseTo(2.5, 0);
});

test('half of a short track counts as a play, and Stats says so', async () => {
  await expect
    .poll(async () => (await value<StatsSummary>('stats.summary')).totalPlays, { timeout: 20_000 })
    .toBeGreaterThan(0);
  const summary = await value<StatsSummary>('stats.summary');
  expect(summary.topTracks[0]?.name).toMatch(/Part$/);
  expect(summary.topAlbums[0]?.name).toBe('Cue Album');
  expect(summary.listenedByMonth).toHaveLength(1);

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Listening stats' }).click();
  await expect(page.getByRole('heading', { name: 'Top tracks' })).toBeVisible();
  await expect(page.getByTestId('month-bar').first()).toBeVisible();
  await settled(page);
  await page.screenshot({ path: join(SCREENSHOTS, 'stats-1280x800.png') });
});
