/*
 * The EQ through the whole UI on the generated library, with --ao=null: open it, drag a node, turn it off, a relaunch,
 * and the signal status. Screenshots go to .dev/screenshots/phase6/.
 */
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import type { EqSettings, PlayerState, ScanState, Track } from '@shared/domain';
import { launchApp, resizeWindow, ROOT, settled, stubFolderDialog } from './helpers/app';
import { generatedLibrary } from './helpers/generatedLibrary';

const E2E = join(ROOT, '.dev', 'e2e-equalizer');
const MUSIC = join(E2E, 'Music');
const SCREENSHOTS = join(ROOT, '.dev', 'screenshots', 'phase6');

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

const playerState = () => value<PlayerState>('player.state');
const storedEq = async (): Promise<EqSettings> => (await playerState()).eq;

async function start(): Promise<void> {
  app = await launchApp({ userData: join(E2E, 'user-data'), dataRoot: join(E2E, 'data') });
  page = await app.firstWindow();
  await page.waitForLoadState('load');
  await resizeWindow(app, page, 1280, 800);
}

const waitForIdleScan = () =>
  expect
    .poll(async () => (await value<ScanState>('scan.state')).phase, { timeout: 120_000, intervals: [100] })
    .toBe('idle');

async function playFirst(): Promise<void> {
  const first = tracks[0];
  if (!first) throw new Error('No tracks');
  await value('player.play', { trackIds: [first.id], startIndex: 0 });
  await expect.poll(async () => (await playerState()).signal.output).not.toBeNull();
}

const node = (number: number) => page.getByRole('slider', { name: `Band ${number}` });

async function centerOf(number: number): Promise<{ x: number; y: number }> {
  const box = await node(number).boundingBox();
  if (!box) throw new Error('No node');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  rmSync(E2E, { recursive: true, force: true });
  mkdirSync(SCREENSHOTS, { recursive: true });
  await generatedLibrary(MUSIC);
  await start();
  await stubFolderDialog(app, MUSIC);
  await page.getByRole('button', { name: 'Choose a folder' }).click();
  await page.getByRole('tab', { name: 'Albums', exact: true }).waitFor();
  await waitForIdleScan();
  tracks = await value<Track[]>('library.tracks', { filter: { kind: 'all' } });
  await playFirst();
});

test.afterAll(async () => {
  await app.close();
});

test('opens over the art from the transport, and from E, flat and saying how to start', async () => {
  await expect(page.getByTestId('equalizer')).toHaveCount(0);
  await page.getByRole('button', { name: 'Equalizer', exact: true }).click();
  await expect(page.getByTestId('equalizer')).toBeVisible();
  await expect(page.getByText('Drag a point to shape the sound')).toBeVisible();
  await expect(page.getByTestId('equalizer').getByRole('slider')).toHaveCount(5);
  expect(await storedEq()).toEqual({ enabled: false, bands: [] });

  const art = await page.getByTestId('art').boundingBox();
  const panel = await page.getByTestId('equalizer').boundingBox();
  expect(panel).toEqual(art);

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('equalizer')).toHaveCount(0);
  await page.keyboard.press('e');
  await expect(page.getByTestId('equalizer')).toBeVisible();
  await expect(node(1)).toBeFocused();
});

test('every target is finger-sized and sits inside the art', async () => {
  const art = await page.getByTestId('art').boundingBox();
  const targets = page.getByTestId('equalizer').locator('button:not([role="switch"])');
  const tap = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.className = 'size-tap';
    document.body.append(probe);
    const size = probe.getBoundingClientRect().width;
    probe.remove();
    return size;
  });
  for (const target of await targets.all()) {
    const box = await target.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(Math.floor(tap));
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(Math.floor(tap));
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual((art?.x ?? 0) + (art?.width ?? 0) + 1);
  }
});

test('dragging a node turns it on, moves the curve and tells the signal status', async () => {
  const before = await page.getByTestId('eq-curve').getAttribute('d');
  const plot = await page.getByTestId('eq-plot').boundingBox();
  const { x, y } = await centerOf(3);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 40, y - (plot?.height ?? 0) / 8, { steps: 8 });
  await page.mouse.up();

  await expect.poll(async () => (await storedEq()).enabled).toBe(true);
  await expect.poll(async () => Math.abs(((await storedEq()).bands[2]?.gainDb ?? 0) - 6)).toBeLessThan(0.4);
  const band = (await storedEq()).bands[2];
  expect(band?.frequencyHz).toBeGreaterThan(1000);
  expect(await page.getByTestId('eq-curve').getAttribute('d')).not.toBe(before);
  await expect(page.getByTestId('eq-Gain')).toHaveText(`+${band?.gainDb.toFixed(1)} dB`);

  await expect.poll(async () => (await playerState()).signal.alterations).toContain('EQ is on');
  expect((await playerState()).signal.isBitPerfect).toBe(false);
  await page.getByTestId('signal-status').locator('visible=true').first().click();
  await expect(page.getByText('EQ is on')).toBeVisible();
  await page.keyboard.press('Escape');
});

test('the keys move the focused node, without seeking or changing the volume', async () => {
  const position = (await value<{ positionMs: number }>('player.position')).positionMs;
  const { volume } = await playerState();
  await node(3).focus();
  const gain = (await storedEq()).bands[2]?.gainDb ?? 0;
  const frequency = (await storedEq()).bands[2]?.frequencyHz ?? 0;

  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await storedEq()).bands[2]?.gainDb).toBeCloseTo(gain + 0.5);
  await page.keyboard.press('Shift+ArrowDown');
  await expect.poll(async () => (await storedEq()).bands[2]?.gainDb).toBeCloseTo(gain - 2.5);
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await storedEq()).bands[2]?.frequencyHz).toBeGreaterThan(frequency);

  expect((await playerState()).volume).toBe(volume);
  const after = (await value<{ positionMs: number }>('player.position')).positionMs;
  expect(Math.abs(after - position)).toBeLessThan(4_000);
});

test('the editor changes kind and values, and bands come and go', async () => {
  await page.getByRole('radio', { name: 'High shelf' }).click();
  await expect.poll(async () => (await storedEq()).bands[2]?.kind).toBe('highshelf');
  await page.getByRole('radio', { name: 'Peak' }).click();
  await expect.poll(async () => (await storedEq()).bands[2]?.kind).toBe('peak');

  const q = (await storedEq()).bands[2]?.q ?? 0;
  await page.getByRole('button', { name: 'Raise Q' }).click();
  await expect.poll(async () => (await storedEq()).bands[2]?.q).toBeGreaterThan(q);

  await page.getByRole('button', { name: 'Add band' }).click();
  await expect(page.getByTestId('equalizer').getByRole('slider')).toHaveCount(6);
  await expect.poll(async () => (await storedEq()).bands).toHaveLength(6);
  await page.getByRole('button', { name: 'Remove band' }).click();
  await expect(page.getByTestId('equalizer').getByRole('slider')).toHaveCount(5);

  for (let added = 0; added < 5; added++) await page.getByRole('button', { name: 'Add band' }).click();
  await expect(page.getByTestId('equalizer').getByRole('slider')).toHaveCount(10);
  await expect(page.getByRole('button', { name: 'Add band' })).toBeDisabled();
  for (let removed = 0; removed < 5; removed++) await page.getByRole('button', { name: 'Remove band' }).click();
  await expect(page.getByTestId('equalizer').getByRole('slider')).toHaveCount(5);
});

test('screenshots', async () => {
  await node(1).focus();
  await page.keyboard.press('Shift+ArrowUp');
  await node(5).focus();
  await page.keyboard.press('Shift+ArrowDown');
  await page.waitForTimeout(400);
  for (const [name, width, height] of [
    ['1280x800', 1280, 800],
    ['1920x1080', 1920, 1080],
  ] as const) {
    await resizeWindow(app, page, width, height);
    await settled(page);
    await page.screenshot({ path: join(SCREENSHOTS, `eq-${name}.png`) });
  }
  await resizeWindow(app, page, 1280, 800);
});

test('turning it off takes it out of the signal, and that survives a relaunch', async () => {
  const bands = (await storedEq()).bands;
  await page.getByTestId('equalizer').getByRole('switch').click();
  await expect.poll(async () => (await storedEq()).enabled).toBe(false);
  await expect.poll(async () => (await playerState()).signal.alterations).not.toContain('EQ is on');
  await expect(page.getByText('Off, so the sound is untouched')).toBeVisible();

  await page.waitForTimeout(500);
  await app.close();
  await start();
  await waitForIdleScan();
  expect(await storedEq()).toEqual({ enabled: false, bands });

  await page.keyboard.press('e');
  await expect(page.getByTestId('equalizer').getByRole('switch')).not.toBeChecked();
  await expect(page.getByTestId('equalizer').getByRole('slider')).toHaveCount(bands.length);

  await page.getByTestId('equalizer').getByRole('switch').click();
  await page.waitForTimeout(500);
  await app.close();
  await start();
  await waitForIdleScan();
  expect((await storedEq()).enabled).toBe(true);
  await playFirst();
  await expect.poll(async () => (await playerState()).signal.alterations).toContain('EQ is on');
});

test('Reset goes back to flat, and the signal stops saying so', async () => {
  await page.keyboard.press('e');
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect.poll(async () => (await storedEq()).bands).toEqual([]);
  await expect(page.getByTestId('equalizer').getByRole('slider')).toHaveCount(5);
  await expect(page.getByText('Drag a point to shape the sound')).toBeVisible();
  await expect.poll(async () => (await playerState()).signal.alterations).not.toContain('EQ is on');
});

test('Close closes it', async () => {
  await page.getByRole('button', { name: 'Close equalizer' }).click();
  await expect(page.getByTestId('equalizer')).toHaveCount(0);
});
