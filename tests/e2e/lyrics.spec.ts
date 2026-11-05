/*
 * Lyrics through the whole UI, on the generated library with made-up words: over the art, moving with the position,
 * the nudge surviving a relaunch, and an import with the dialog stubbed. Nothing reaches LRCLIB: fetch is stubbed in main.
 * Screenshots go to .dev/screenshots/phase6/.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import type { ElectronApplication, Page } from 'playwright';
import type { Lyrics, ScanState, StorageInfo, Track } from '@shared/domain';
import {
  closeSettings,
  launchApp,
  openSettingsTab,
  resizeWindow,
  ROOT,
  settled,
  stubFolderDialog,
} from './helpers/app';
import { generatedLibrary } from './helpers/generatedLibrary';

const E2E = join(ROOT, '.dev', 'e2e-lyrics');
const MUSIC = join(E2E, 'Music');
const SCREENSHOTS = join(ROOT, '.dev', 'screenshots', 'phase6');

const MADE_UP_LRC = [
  '[ar:Nobody]',
  '[00:05.00]Plum trees over the quiet water',
  '[00:10.00]Pears are falling on the marble stair',
  '[00:15.00]Quince and juniper and silver lantern moons that go on for long enough to wrap around the pane',
  '[00:20.00]',
  '[00:25.00]Figs along the northern harbour line',
  '[00:30.00]Damsons in the amber rain',
  '[00:35.00]Medlars under velvet static',
].join('\r\n');

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

async function start(): Promise<void> {
  app = await launchApp({ userData: join(E2E, 'user-data'), dataRoot: join(E2E, 'data') });
  await app.evaluate(() => {
    (globalThis as { lrclibAsks?: number }).lrclibAsks = 0;
    globalThis.fetch = () => {
      (globalThis as unknown as { lrclibAsks: number }).lrclibAsks += 1;
      return Promise.resolve(new Response(null, { status: 404 }));
    };
  });
  page = await app.firstWindow();
  await page.waitForLoadState('load');
  await resizeWindow(app, page, 1280, 800);
}

const waitForIdleScan = () =>
  expect
    .poll(async () => (await value<ScanState>('scan.state')).phase, { timeout: 120_000, intervals: [100] })
    .toBe('idle');

function trackAt(index: number): Track {
  const track = tracks[index];
  if (!track) throw new Error('Not enough tracks');
  return track;
}

async function playPaused(track: Track): Promise<void> {
  await value('player.play', { trackIds: [track.id], startIndex: 0 });
  await value('player.pause');
  await expect.poll(async () => (await value<{ status: string }>('player.state')).status).toBe('paused');
}

const seekTo = (positionMs: number) => value('player.seek', { positionMs });
const lit = () => page.locator('[data-testid="lyrics-lines"] [aria-current="true"]');

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  rmSync(E2E, { recursive: true, force: true });
  mkdirSync(SCREENSHOTS, { recursive: true });
  await generatedLibrary(MUSIC);
  await start();
  await stubFolderDialog(app, MUSIC);
  await page.getByRole('button', { name: 'Choose a folder' }).click();
  await page.getByRole('tab', { name: 'Albums', exact: true }).click();
  await page.getByRole('tab', { name: 'Albums', exact: true }).waitFor();
  await waitForIdleScan();
  tracks = await value<Track[]>('library.tracks', { filter: { kind: 'all' } });

  const lrcPath = join(MUSIC, trackAt(0).relPath.replace(/\.[^.]+$/, '.lrc'));
  writeFileSync(lrcPath, `\ufeff${MADE_UP_LRC}`);
});

test.afterAll(async () => {
  await app.close();
});

test('tapping the art opens lyrics, and the line follows the position', async () => {
  await playPaused(trackAt(0));
  await expect(page.getByTestId('lyrics')).toHaveCount(0);

  await page.getByTestId('art').click({ position: { x: 300, y: 300 } });
  await expect(page.getByTestId('lyrics')).toBeVisible();
  await expect(page.getByText('Figs along the northern harbour line')).toBeVisible();
  await expect(page.getByText('Nobody')).toHaveCount(0);

  await seekTo(11_000);
  await expect(lit()).toHaveText('Pears are falling on the marble stair');
  await seekTo(26_000);
  await expect(lit()).toHaveText('Figs along the northern harbour line');

  // A timed empty line ends the one before it, and nothing is lit in the gap.
  await seekTo(21_000);
  await expect(lit()).toHaveCount(0);

  const lines = page.getByTestId('lyrics-lines');
  await seekTo(36_000);
  await expect(lit()).toHaveText('Medlars under velvet static');
  await expect
    .poll(() =>
      lit().evaluate((row) => {
        const scroller = row.parentElement as HTMLElement;
        const rowBox = row.getBoundingClientRect();
        const box = scroller.getBoundingClientRect();
        return Math.abs(rowBox.top + rowBox.height / 2 - (box.top + box.height / 2));
      }),
    )
    .toBeLessThan(4);
  await expect(lines).toBeVisible();
});

test('tapping a line seeks to it', async () => {
  await page.getByText('Damsons in the amber rain').click();
  await expect(lit()).toHaveText('Damsons in the amber rain');
  await expect
    .poll(async () => (await value<{ positionMs: number }>('player.position')).positionMs)
    .toBeGreaterThanOrEqual(29_900);
});

test('the controls sit below the title bar strip', async () => {
  const strip = await page.getByTestId('title-bar').boundingBox();
  const lines = await page.getByTestId('lyrics-lines').boundingBox();
  expect(lines?.y ?? 0).toBeGreaterThanOrEqual((strip?.y ?? 0) + (strip?.height ?? 0) - 1);
});

test('screenshots', async () => {
  // For half a second after a tap on a line, the seekbar's clock takes a far report for one from before that seek.
  await page.waitForTimeout(600);
  await seekTo(11_000);
  await expect(lit()).toHaveText('Pears are falling on the marble stair');
  for (const [name, width, height] of [
    ['1280x800', 1280, 800],
    ['1920x1080', 1920, 1080],
  ] as const) {
    await resizeWindow(app, page, width, height);
    await seekTo(16_000);
    await settled(page);
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(SCREENSHOTS, `lyrics-synced-${name}.png`) });
  }
  await resizeWindow(app, page, 1280, 800);
});

test('the nudge moves the line and survives a relaunch', async () => {
  await seekTo(10_200);
  await expect(lit()).toHaveText('Pears are falling on the marble stair');

  await page.getByRole('button', { name: 'Show lyrics later' }).click();
  await expect(page.getByTestId('lyrics-offset')).toHaveText('+0.5 s');
  await expect(lit()).toHaveText('Plum trees over the quiet water');

  await page.getByRole('button', { name: 'Show lyrics earlier' }).click();
  await page.getByRole('button', { name: 'Show lyrics later' }).click();
  await expect(page.getByTestId('lyrics-offset')).toHaveText('+0.5 s');
  await expect
    .poll(
      async () =>
        (await value<Extract<Lyrics, { status: 'found' }>>('lyrics.get', { trackId: trackAt(0).id })).offsetMs,
    )
    .toBe(500);

  await app.close();
  await start();
  await waitForIdleScan();
  await playPaused(trackAt(0));
  await page.keyboard.press('l');
  await expect(page.getByTestId('lyrics-offset')).toHaveText('+0.5 s');

  await page.getByRole('button', { name: 'Reset lyrics timing' }).click();
  await expect(page.getByTestId('lyrics-offset')).toHaveText('0 s');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('lyrics')).toHaveCount(0);
});

test('with nothing to show it says so calmly, and can search again', async () => {
  await playPaused(trackAt(5));
  await page.keyboard.press('l');
  await expect(page.getByText('No lyrics for this track')).toBeVisible();
  await page.screenshot({ path: join(SCREENSHOTS, 'lyrics-none-1280x800.png') });

  const asks = () => app.evaluate(() => (globalThis as unknown as { lrclibAsks: number }).lrclibAsks);
  const before = await asks();
  await page.getByRole('button', { name: 'Search again' }).click();
  await expect.poll(asks).toBeGreaterThan(before);
  await expect(page.getByText('No lyrics for this track')).toBeVisible();
  // It rests after a press, so it can't be used to hammer LRCLIB.
  await expect(page.getByRole('button', { name: 'Search again' })).toBeDisabled();
});

test('pasted lyrics with times show as timed lyrics', async () => {
  await playPaused(trackAt(5));
  await page.getByRole('button', { name: 'Type in' }).click();
  await page
    .getByRole('textbox', { name: 'Lyrics' })
    .fill('[00:00.50]Pasted first line\n[00:03.00]Pasted second line');
  await page.getByRole('button', { name: 'Save lyrics' }).click();
  await expect(page.getByText('Pasted first line')).toBeVisible();
  await page.keyboard.press('Escape');
});

test('lyrics follow the current track', async () => {
  await playPaused(trackAt(0));
  await expect(page.getByText('Figs along the northern harbour line')).toBeVisible();
  await page.keyboard.press('l');
});

test('importing a lyrics library matches by hash and reports it', async () => {
  const { databasePath } = await value<StorageInfo>('system.storageInfo');
  const library = new Database(databasePath ?? '', { readonly: true });
  // Silence of the same length hashes the same, so only tracks with a hash of their own say what matched.
  const own = library
    .prepare<[number, number], { id: number; hash: string }>(
      `SELECT t.id, f.audio_hash AS hash FROM tracks t JOIN files f ON f.id = t.file_id
       WHERE t.id NOT IN (?, ?) GROUP BY f.audio_hash HAVING count(*) = 1 ORDER BY t.id LIMIT 3`,
    )
    .all(trackAt(0).id, trackAt(5).id);
  library.close();

  const sourcePath = join(E2E, 'lyrics.db');
  const source = new Database(sourcePath);
  source.exec(`CREATE TABLE lyrics (
    rel_path TEXT PRIMARY KEY, audio_hash TEXT NOT NULL, status TEXT NOT NULL, synced_lrc TEXT, plain_text TEXT,
    fetched_at INTEGER NOT NULL)`);
  const insert = source.prepare('INSERT INTO lyrics VALUES (?, ?, ?, ?, ?, 1)');
  insert.run('a', own[0]?.hash, 'found', null, 'Imported quince along the marble hall');
  insert.run('b', own[1]?.hash, 'instrumental', null, null);
  insert.run('c', own[2]?.hash, 'not_found', null, null);
  insert.run('d', 'not in this library', 'found', null, 'Unmatched medlars');
  source.close();

  const ownTrack = (index: number): Track => {
    const track = tracks.find(({ id }) => id === own[index]?.id);
    if (!track) throw new Error('No such track');
    return track;
  };

  await stubFolderDialog(app, sourcePath);
  await openSettingsTab(page, 'Lyrics');
  await page.getByRole('button', { name: 'Import lyrics library' }).click();
  await expect(page.getByText('Matched 2 tracks: 2 added').first()).toBeVisible();
  await closeSettings(page);

  await playPaused(ownTrack(0));
  await page.keyboard.press('l');
  await expect(page.getByTestId('lyrics-plain')).toHaveText('Imported quince along the marble hall');

  await playPaused(ownTrack(1));
  await expect(page.getByTestId('lyrics').getByText('Instrumental')).toBeVisible();
  await page.screenshot({ path: join(SCREENSHOTS, 'lyrics-instrumental-1280x800.png') });

  const asksBefore = await app.evaluate(() => (globalThis as unknown as { lrclibAsks: number }).lrclibAsks);
  await playPaused(ownTrack(2));
  await expect(page.getByTestId('lyrics').getByText('No lyrics for this track')).toBeVisible();
  // A row left behind means the app still asks.
  expect(await app.evaluate(() => (globalThis as unknown as { lrclibAsks: number }).lrclibAsks)).toBeGreaterThan(
    asksBefore,
  );
});
