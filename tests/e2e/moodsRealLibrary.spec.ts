/*
 * Mood stations on the real music folder: a Study station made in the tuner, graded, saved and played, with screenshots
 * at each size. Read-only on the folder. Skipped unless MUSIC_PLAYER_REAL_LIBRARY names it and the fingerprinted copy
 * from the energy research is in .dev/energy. Writes to .dev/real/moods/ and .dev/screenshots/moods/.
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Locator, Page } from 'playwright';
import { launchApp, resizeWindow, ROOT, settled, stubFolderDialog } from './helpers/app';

const FOLDER = process.env.MUSIC_PLAYER_REAL_LIBRARY;
const FINGERPRINTED = join(ROOT, '.dev', 'energy', 'library.db');
const SCANNED_BEFORE = join(ROOT, '.dev', 'real', 'ui');
const OUTPUT = join(ROOT, '.dev', 'real', 'moods');
const SCREENSHOTS = join(ROOT, '.dev', 'screenshots', 'moods');
const SIZES = [
  [1280, 800],
  [1920, 1080],
  [3840, 2160],
] as const;

test.skip(
  !FOLDER || !existsSync(FINGERPRINTED),
  'Set MUSIC_PLAYER_REAL_LIBRARY, with the fingerprinted copy in .dev/energy',
);
test.describe.configure({ mode: 'serial' });

let app: ElectronApplication;
let page: Page;
const problems: string[] = [];
let folderBefore: string;

/** When the folder and the installed app's .player in it last changed, which a run must leave as they were. */
function folderState(folder: string): string {
  const player = join(folder, '.player');
  const times = [statSync(folder).mtimeMs, existsSync(player) ? statSync(player).mtimeMs : null];
  return JSON.stringify(times);
}

const dialog = (name: string) => page.getByRole('dialog', { name });

async function value<T>(name: string, input?: unknown): Promise<T> {
  const result = (await page.evaluate(
    ([command, args]) =>
      (window.api.invoke as (...values: unknown[]) => Promise<unknown>)(command, ...(args === undefined ? [] : [args])),
    [name, input] as const,
  )) as { ok: true; value: T } | { ok: false; error: { message: string } };
  if (!result.ok) throw new Error(`${name}: ${result.error.message}`);
  return result.value;
}

/** The fingerprinted copy in place of the scanned one's database, so each run starts with no stations. */
function prepare(): void {
  rmSync(join(OUTPUT, 'data'), { recursive: true, force: true });
  if (!existsSync(join(OUTPUT, 'user-data'))) {
    cpSync(join(SCANNED_BEFORE, 'user-data'), join(OUTPUT, 'user-data'), { recursive: true });
  }
  const [libraryId] = readdirSync(join(SCANNED_BEFORE, 'data'));
  if (libraryId === undefined) throw new Error('No scanned library to borrow settings from');
  mkdirSync(join(OUTPUT, 'data', libraryId), { recursive: true });
  copyFileSync(FINGERPRINTED, join(OUTPUT, 'data', libraryId, 'library.db'));
  mkdirSync(SCREENSHOTS, { recursive: true });
}

/** At each size, with `inView` scrolled into view once the layout has settled at that size. */
async function shoot(name: string, inView: Locator | null = null): Promise<void> {
  for (const [width, height] of SIZES) {
    await resizeWindow(app, page, width, height);
    await settled(page);
    if (inView !== null) {
      await inView.evaluate((element) => element.scrollIntoView({ block: 'start' }));
      await settled(page);
    }
    await page.screenshot({ path: join(SCREENSHOTS, `${name}-${width}x${height}.png`) });
  }
  await resizeWindow(app, page, 1920, 1080);
}

async function say(tuner: ReturnType<typeof dialog>, search: string, name: string, isYes: boolean): Promise<void> {
  const field = tuner.getByLabel('Search for songs, albums, artists or genres');
  await field.fill(search);
  const label = isYes ? `Yes, ${name} sounds like it` : `No, ${name} doesn't`;
  await tuner.getByRole('button', { name: label, exact: true }).click();
  await expect(tuner.getByRole('button', { name: `Take ${name} out` })).toBeVisible();
}

test.beforeAll(async () => {
  test.setTimeout(10 * 60 * 1000);
  const folder = FOLDER as string;
  folderBefore = folderState(folder);
  prepare();
  // At this laptop's scale of 2, a 4K window is 7680 pixels wide and the compositor leaves parts of it unpainted in a
  // capture. A TV at 3840 x 2160 runs at 1, which is what's worth seeing.
  app = await launchApp({
    userData: join(OUTPUT, 'user-data'),
    dataRoot: join(OUTPUT, 'data'),
    switches: ['--force-device-scale-factor=1'],
  });
  page = await app.firstWindow();
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.location().url.startsWith('art://')) problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  await page.waitForLoadState('load');
  if (await page.getByRole('button', { name: 'Choose a folder' }).isVisible()) {
    await stubFolderDialog(app, folder);
    await page.getByRole('button', { name: 'Choose a folder' }).click();
  }
  await page.getByRole('tab', { name: 'Albums', exact: true }).waitFor({ timeout: 60_000 });
  await resizeWindow(app, page, 1920, 1080);
});

test.afterAll(async () => {
  await app.close();
  expect(folderState(FOLDER as string)).toBe(folderBefore);
});

test('a mood made in the tuner from examples, graded, saved, and played', async () => {
  test.setTimeout(10 * 60 * 1000);
  await page.getByRole('button', { name: 'Radio', exact: true }).first().click();
  await page.getByRole('button', { name: 'Tune it', exact: true }).click();
  const tuneIt = dialog('Tune it');
  await expect(tuneIt.getByRole('button', { name: /New mood/ })).toBeVisible();
  await shoot('tune-it-no-moods');

  await tuneIt.getByRole('button', { name: /New mood/ }).click();
  const tuner = dialog('New mood');
  await expect(tuner.getByLabel('Mood name')).toBeFocused();
  await shoot('tuner-new');
  await tuner.getByLabel('Mood name').fill('Study');
  await say(tuner, 'einaudi', 'Ludovico Einaudi', true);
  await say(tuner, 'brickman', 'Jim Brickman', true);
  await say(tuner, 'lo fi hip', 'Lo Fi Hip Hop', true);
  await say(tuner, 'mozart', 'Wolfgang Amadeus Mozart', true);
  await say(tuner, 'schubert', 'Franz Schubert', false);
  await say(tuner, 'johann sebastian', 'Johann Sebastian Bach', false);
  await tuner.getByLabel('Search for songs, albums, artists or genres').fill('');
  await expect(tuner.getByText(/^Plays [\d,]+ songs$/)).toBeVisible({ timeout: 120_000 });
  await expect(tuner.getByRole('button', { name: /^Play / }).first()).toBeVisible();
  await shoot('tuner-examples');

  await tuner.getByRole('heading', { name: 'What plays' }).scrollIntoViewIfNeeded();
  await tuner.getByRole('button', { name: 'Check how clear it is' }).click();
  await expect(tuner.getByText(/^(Clear|Fuzzy)\./)).toBeVisible({ timeout: 240_000 });
  await shoot('tuner-graded', tuner.getByRole('heading', { name: 'What plays' }));

  await tuner.getByRole('button', { name: 'Create' }).click();
  await expect(tuner).toBeHidden();
  const card = tuneIt.getByRole('button', { name: 'Start Study' });
  await expect(card).toBeVisible();
  await expect(card).toContainText(/[\d,]+ songs/);
  await shoot('tune-it-with-a-mood');

  await card.click();
  await expect(tuneIt).toBeHidden();
  await expect
    .poll(async () => (await value<{ radio: { isSource: boolean } }>('player.state')).radio.isSource, {
      timeout: 60_000,
    })
    .toBe(true);
  await expect(page.getByRole('button', { name: 'Not for Study' })).toBeVisible();
  await shoot('playing-study');
  expect(problems).toEqual([]);
});

test('a mark while it plays is kept, and what comes next is picked again with it', async () => {
  test.setTimeout(3 * 60 * 1000);
  type State = {
    current: { id: number; title: string } | null;
    radio: { isStarting: boolean; stationId: number; upNext: { id: number }[] };
  };
  const before = await value<State>('player.state');
  const stationId = before.radio.stationId;
  await page.getByRole('button', { name: 'Not for Study' }).click();
  await expect(page.getByText(/^Marked .* as not for Study\./)).toBeVisible();

  // Picked again, which for a station whose examples changed means fitting it again first.
  const started = Date.now();
  await expect
    .poll(async () => (await value<State>('player.state')).radio.isStarting, { timeout: 60_000, intervals: [100] })
    .toBe(false);
  const after = await value<State>('player.state');
  test.info().annotations.push({ type: 'picked again in', description: `${Date.now() - started} ms` });
  expect(after.radio.upNext.length).toBeGreaterThan(0);
  expect(after.radio.upNext.some(({ id }) => id === before.current?.id)).toBe(false);

  const station = await value<{ examples: { label: string; isYes: boolean; source: string }[] }>('moods.get', {
    stationId,
  });
  expect(station.examples.at(-1)).toMatchObject({ isYes: false, source: 'listening' });
  expect(station.examples.at(-1)?.label.startsWith(before.current?.title ?? '?')).toBe(true);

  await page.getByRole('button', { name: 'Tune it', exact: true }).click();
  await dialog('Tune it').getByRole('button', { name: 'Edit Study' }).click();
  const tuner = dialog('Tune mood');
  await expect(tuner.getByText('while listening')).toBeVisible();
  await shoot('tuner-listening-mark');
  expect(problems).toEqual([]);
});
