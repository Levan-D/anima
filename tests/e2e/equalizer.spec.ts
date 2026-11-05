/*
 * The EQ through the whole UI on the generated library, with --ao=null: open it, drag a node, turn it off, a relaunch,
 * and the signal status. Screenshots go to .dev/screenshots/phase6/.
 */
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import { EQ_MAX_GAIN_DB, type EqSettings, type PlayerState, type ScanState, type Track } from '@shared/domain';
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
  await page.getByRole('tab', { name: 'Albums', exact: true }).click();
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
  await page.getByRole('menuitem', { name: 'Edit presets' }).click();
  await expect(page.getByTestId('equalizer')).toBeVisible();
  await expect(page.getByText('Drag a point to shape the sound')).toBeVisible();
  await expect(page.getByTestId('equalizer').getByRole('slider')).toHaveCount(5);
  expect(await storedEq()).toMatchObject({ enabled: false, bands: [] });

  // A modal over everything now, and it rises as it fades in, so this waits for it to settle inside the window.
  await expect
    .poll(async () => {
      const box = await page.getByTestId('equalizer').boundingBox();
      const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      return (
        box !== null && box.x >= 0 && box.y >= 0 && box.x + box.width <= size.width && box.y + box.height <= size.height
      );
    })
    .toBe(true);

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('equalizer')).toHaveCount(0);
  await page.keyboard.press('e');
  await expect(page.getByTestId('equalizer')).toBeVisible();
  await expect(node(1)).toBeFocused();
});

test('every target is finger-sized on a touch screen, and sits inside the equalizer', async () => {
  // Buttons look smaller than a finger with a mouse, and grow an invisible 44px hit area under a coarse pointer.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'any-pointer', value: 'coarse' }] });
  try {
    expect(await page.evaluate(() => matchMedia('(any-pointer: coarse)').matches)).toBe(true);
    const tap = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.className = 'size-tap';
      document.body.append(probe);
      const size = probe.getBoundingClientRect().width;
      probe.remove();
      return size;
    });
    // It pops in from slightly smaller, and the last test has only just opened it.
    await page
      .getByTestId('equalizer')
      .evaluate((panel) =>
        Promise.all(
          (panel.closest('[role="dialog"]') ?? panel).getAnimations({ subtree: true }).map(({ finished }) => finished),
        ),
      );
    const panel = await page.getByTestId('equalizer').boundingBox();
    const targets = await page
      .getByTestId('equalizer')
      .locator('button:not([role="switch"])')
      .evaluateAll((buttons: HTMLElement[]) =>
        buttons.map((button) => {
          // Layout sizes, which no transform changes. A button's own box, or its touch area if that's bigger.
          // A checkbox is tapped by its whole row, which its label is.
          const target = button.closest('label') ?? button;
          const hit = getComputedStyle(button, '::after');
          const isHitArea = hit.position === 'absolute';
          return {
            name: (button.getAttribute('aria-label') ?? target.textContent ?? '').trim(),
            width: Math.max(target.offsetWidth, isHitArea ? parseFloat(hit.width) : 0),
            height: Math.max(target.offsetHeight, isHitArea ? parseFloat(hit.height) : 0),
            right: button.getBoundingClientRect().right,
          };
        }),
      );
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(Math.round(target.width), target.name).toBeGreaterThanOrEqual(Math.floor(tap));
      expect(Math.round(target.height), target.name).toBeGreaterThanOrEqual(Math.floor(tap));
      expect(target.right, target.name).toBeLessThanOrEqual((panel?.x ?? 0) + (panel?.width ?? 0) + 1);
    }
  } finally {
    await cdp.send('Emulation.setEmulatedMedia', { features: [] });
    await cdp.detach();
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
  // An eighth of the plot's height, which spans the whole range from -max to +max.
  const raised = (EQ_MAX_GAIN_DB * 2) / 8;
  await expect.poll(async () => Math.abs(((await storedEq()).bands[2]?.gainDb ?? 0) - raised)).toBeLessThan(0.4);
  const band = (await storedEq()).bands[2];
  expect(band?.frequencyHz).toBeGreaterThan(1000);
  expect(await page.getByTestId('eq-curve').getAttribute('d')).not.toBe(before);
  await expect(page.getByTestId('eq-Gain')).toHaveValue(`+${band?.gainDb.toFixed(1)} dB`);

  await expect.poll(async () => (await playerState()).signal.alterations).toContain('EQ is on');
  expect((await playerState()).signal.isBitPerfect).toBe(false);
  // The equalizer covers the window, the signal status included, so it closes to look and opens again after.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('equalizer')).toHaveCount(0);
  await page.getByTestId('signal-status').locator('visible=true').first().click();
  await expect(page.getByText('EQ is on')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('EQ is on')).toBeHidden();
  await page.keyboard.press('e');
  await expect(page.getByTestId('equalizer')).toBeVisible();
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

test('Flat turns it off and out of the signal, a change turns it on, and both survive a relaunch', async () => {
  // Off is the Flat preset, from the transport's menu: it takes the curve away too.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('equalizer')).toHaveCount(0);
  await page.getByRole('button', { name: 'Equalizer', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Flat' }).click();
  await expect.poll(async () => (await storedEq()).enabled).toBe(false);
  expect((await storedEq()).bands).toEqual([]);
  await expect.poll(async () => (await playerState()).signal.alterations).not.toContain('EQ is on');

  await page.waitForTimeout(500);
  await app.close();
  await start();
  await waitForIdleScan();
  expect((await storedEq()).enabled).toBe(false);

  // Shaping the curve is what turns it back on.
  await page.keyboard.press('e');
  await expect(page.getByTestId('equalizer')).toBeVisible();
  const plot = await page.getByTestId('eq-plot').boundingBox();
  const { x, y } = await centerOf(3);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - (plot?.height ?? 0) / 8, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await storedEq()).enabled).toBe(true);

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
  await page.getByRole('button', { name: 'Reset curve' }).click();
  await expect.poll(async () => (await storedEq()).bands).toEqual([]);
  await expect(page.getByTestId('equalizer').getByRole('slider')).toHaveCount(5);
  await expect(page.getByText('Drag a point to shape the sound')).toBeVisible();
  await expect.poll(async () => (await playerState()).signal.alterations).not.toContain('EQ is on');
});

test('Close closes it', async () => {
  await page.getByRole('button', { name: 'Close equalizer' }).click();
  await expect(page.getByTestId('equalizer')).toHaveCount(0);
});
