/*
 * The headphone tools through the UI with --ao=null and made-up curves, written here so nothing third-party is in the repo.
 * Screenshots go to .dev/screenshots/headphones/. With AUTOEQ_LIVE=1 it also fetches one real headphone, into .dev only.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import type { HeadphoneState } from '@shared/headphone';
import { launchApp, resizeWindow, ROOT, stubFolderDialog } from './helpers/app';
import { generatedLibrary } from './helpers/generatedLibrary';

const E2E = join(ROOT, '.dev', 'e2e-headphones');
const MUSIC = join(E2E, 'Music');
const SCREENSHOTS = join(ROOT, '.dev', 'screenshots', 'headphones');

let app: ElectronApplication;
let page: Page;

async function value<T>(name: string, input?: unknown): Promise<T> {
  const result = (await page.evaluate(
    ([command, args]) =>
      (window.api.invoke as (...values: unknown[]) => Promise<unknown>)(command, ...(args === undefined ? [] : [args])),
    [name, input] as const,
  )) as { ok: true; value: T } | { ok: false; error: { message: string } };
  if (!result.ok) throw new Error(`${name}: ${result.error.message}`);
  return result.value;
}

function csv(shape: (hz: number) => number): string {
  const lines = ['frequency,raw'];
  for (let point = 0; point <= 480; point++) {
    const hz = 20 * 2 ** (point / 48);
    lines.push(`${hz.toFixed(2)},${shape(hz).toFixed(2)}`);
  }
  return lines.join('\n');
}

const hump = (hz: number, at: number, width: number, height: number) =>
  height * Math.exp(-((Math.log2(hz / at) / width) ** 2));

// Invented to have the shape of a response on an ear simulator, wiggles and all. Not anyone's headphone.
const MEASURED = csv(
  (hz) =>
    72 +
    hump(hz, 3000, 1, 11) -
    hump(hz, 20, 2.2, 8) +
    hump(hz, 120, 0.6, 2) -
    hump(hz, 9000, 0.25, 6) +
    hump(hz, 6000, 0.2, 4) -
    (hz > 12_000 ? 3 * Math.log2(hz / 12_000) * 3 : 0) +
    0.5 * Math.sin(Math.log2(hz) * 22),
);
const TARGET = csv(
  (hz) => 70 + hump(hz, 2800, 1, 9) + hump(hz, 40, 1.8, 4) - (hz > 8000 ? 4 * Math.log2(hz / 8000) : 0),
);

function write(name: string, text: string): string {
  const path = join(E2E, name);
  writeFileSync(path, text);
  return path;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  rmSync(E2E, { recursive: true, force: true });
  mkdirSync(SCREENSHOTS, { recursive: true });
  await generatedLibrary(MUSIC);
  app = await launchApp({ userData: join(E2E, 'user-data'), dataRoot: join(E2E, 'data') });
  page = await app.firstWindow();
  await page.waitForLoadState('load');
  await resizeWindow(app, page, 1280, 800);
  await stubFolderDialog(app, MUSIC);
  await page.getByRole('button', { name: 'Choose a folder' }).click();
  await expect
    .poll(async () => (await value<{ phase: string }>('scan.state')).phase, { timeout: 120_000, intervals: [100] })
    .toBe('idle');
  await page.getByRole('button', { name: 'Equalizer', exact: true }).click();
  await expect(page.getByTestId('equalizer')).toBeVisible();
});

test.afterAll(async () => {
  await app.close();
});

const shot = (name: string) => page.screenshot({ path: join(SCREENSHOTS, `${name}.png`) });

test('stays calm until asked: no tools, no lines, and the usual scale', async () => {
  await expect(page.getByTestId('hp-open')).toBeVisible();
  await expect(page.getByTestId('hp-tools')).toHaveCount(0);
  await expect(page.getByTestId('hp-measured')).toHaveCount(0);
  await expect(page.getByTestId('eq-plot').getByText('+12', { exact: true })).toBeVisible();
  await shot('1-calm');
});

test('imports a measurement, naming what it is, and draws it wider with a note on what it is', async () => {
  await page.getByTestId('hp-open').click();
  await expect(page.getByTestId('hp-tools')).toBeVisible();
  await expect(page.getByText('Pick a headphone to see')).toBeVisible();
  await page.getByTestId('hp-measurement').click();
  await page.getByRole('menuitem', { name: 'Import a file' }).click();

  const dialog = page.getByRole('dialog', { name: 'Import a measurement' });
  await dialog.getByLabel('Headphone').fill('Made Up One');
  await dialog.getByLabel('Measured by').fill('Levan');
  await dialog.getByRole('button', { name: /^Rig:/ }).click();
  await page.getByRole('menuitem', { name: /GRAS 43AG or 45CA/ }).click();
  await dialog.getByLabel('Exact rig').fill('GRAS 43AG');

  await stubFolderDialog(app, write('bad.csv', 'frequency,raw\n20,1\n100,oops\n'));
  await dialog.getByRole('button', { name: 'Choose file' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Line 3: can\'t read "oops" as a level');

  await stubFolderDialog(app, write('one.csv', MEASURED));
  await dialog.getByRole('button', { name: 'Choose file' }).click();
  await expect(dialog).toHaveCount(0);

  await expect(page.getByTestId('hp-measured')).toHaveCount(1);
  await expect(page.getByText("Measured: Levan's Made Up One (GRAS 43AG), smoothed to 1/12 octave")).toBeVisible();
  await expect(page.getByText("Predicted, not measured: Levan's Made Up One (GRAS 43AG) plus your EQ")).toHaveCount(0);
  await expect(page.getByText(/Aligned over 300 Hz to 3 kHz/)).toBeVisible();
  await expect(
    page.getByText(/Your pair and your head will differ, most of all above 6 kHz and in the bass if it doesn't seal/),
  ).toBeVisible();
  await expect(page.getByTestId('eq-plot').getByText('+12', { exact: true })).toBeVisible();
  await expect(page.getByTestId('eq-plot').getByText('+18', { exact: true })).toBeVisible();
  await expect(page.getByTestId('hp-grey-above')).toHaveCount(1);
});

test("the predicted line follows a node, at the plot's one scale, and only with the EQ on", async () => {
  const plot = await page.getByTestId('eq-plot').boundingBox();
  const node = page.getByRole('slider', { name: 'Band 4' });
  const box = await node.boundingBox();
  await page.mouse.move((box?.x ?? 0) + (box?.width ?? 0) / 2, (box?.y ?? 0) + (box?.height ?? 0) / 2);
  await page.mouse.down();
  await page.mouse.move((box?.x ?? 0) + (box?.width ?? 0) / 2, (box?.y ?? 0) + (plot?.height ?? 0) / 8, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId('hp-predicted')).toHaveCount(1);
  await expect(page.getByText("Predicted, not measured: Levan's Made Up One (GRAS 43AG) plus your EQ")).toBeVisible();
  const first = await page.getByTestId('hp-predicted').getAttribute('d');
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => page.getByTestId('hp-predicted').getAttribute('d')).not.toBe(first);
});

test('a target on another rig is hidden, with why', async () => {
  await page.getByTestId('hp-target-menu').click();
  await page.getByRole('menuitem', { name: 'Import a file' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import a target' });
  await dialog.getByLabel('Target name').fill('Made Up Target');
  await dialog.getByLabel('Measured by').fill('Levan');
  await dialog.getByRole('button', { name: /^Rig:/ }).click();
  await page.getByRole('menuitem', { name: /B&K 5128/ }).click();
  await stubFolderDialog(app, write('target.csv', TARGET));
  await dialog.getByRole('button', { name: 'Choose file' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByText('Made Up Target is defined on another rig. Not shown against this measurement'),
  ).toBeVisible();
  await expect(page.getByTestId('hp-target')).toHaveCount(0);
  await expect(page.getByText(/Difference from/)).toHaveCount(0);
});

test('a target in the same family is drawn and labelled approximate, with a named difference view', async () => {
  await page.getByTestId('hp-target-menu').click();
  await page.getByRole('menuitem', { name: 'Import a file' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import a target' });
  await dialog.getByLabel('Target name').fill('Close Target');
  await dialog.getByLabel('Measured by').fill('Levan');
  await dialog.getByRole('button', { name: /^Rig:/ }).click();
  await page.getByRole('menuitem', { name: /GRAS 43AG or 45CA/ }).click();
  await dialog.getByLabel('Exact rig').fill('GRAS 45CA');
  await dialog.getByRole('button', { name: 'Choose file' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('hp-target')).toHaveCount(1);
  await expect(page.getByText(/Close Target is approximate here/)).toBeVisible();
  await page.getByRole('button', { name: 'Bass on the target' }).click();
  await expect(page.getByRole('tooltip').first()).toContainText('In Olive 2022, 64% of listeners preferred it');
  await page.getByRole('button', { name: 'Bass on the target' }).click();
  await shot('2-overlay-1280');

  const before = await page.getByTestId('hp-target').getAttribute('d');
  await page.getByRole('slider', { name: 'Bass on the target' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.getByTestId('hp-target').getAttribute('d')).not.toBe(before);

  await page.getByRole('switch', { name: 'Difference from Close Target' }).click();
  await expect(page.getByTestId('hp-target')).toHaveCount(0);
  await expect(page.getByText('0 is Close Target')).toBeVisible();
  await shot('3-difference-1280');
  await page.getByRole('switch', { name: 'Difference from Close Target' }).click();
});

test('holding hears the off side at a matched level, and letting go puts the EQ back as it was', async () => {
  const before = (await value<{ eq: unknown }>('player.state')).eq;
  const button = page.getByTestId('hp-compare');
  const box = await button.boundingBox();
  await page.mouse.move((box?.x ?? 0) + 4, (box?.y ?? 0) + 4);
  await page.mouse.down();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(async () => (await value<{ eq: { preamp: { auto: boolean } } }>('player.state')).eq.preamp.auto)
    .toBe(false);
  await expect(page.getByText(/Matched by curve, not by loudness measurement/)).toBeVisible();
  // The screen stays on what's being compared.
  await expect(page.getByTestId('hp-predicted')).toHaveCount(1);
  await page.mouse.up();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await value<{ eq: unknown }>('player.state')).eq).toEqual(before);
});

test('reads at the other sizes', async () => {
  await resizeWindow(app, page, 1920, 1080);
  await shot('4-overlay-1920');
  await resizeWindow(app, page, 3840, 2160);
  await shot('5-overlay-3840');
  await resizeWindow(app, page, 1280, 800);
});

test('fetches a real headphone from AutoEq', async () => {
  test.skip(process.env.AUTOEQ_LIVE !== '1', 'Only when asked, since it goes out to the network');
  test.setTimeout(120_000);
  await page.getByTestId('hp-measurement').click();
  await page.getByRole('menuitem', { name: 'Find on AutoEq' }).click();
  const dialog = page.getByRole('dialog', { name: 'Find on AutoEq' });
  await dialog.getByRole('textbox', { name: 'Headphone' }).fill('HD 800 oratory1990');
  await dialog.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByTestId('autoeq-results').getByRole('button').first()).toBeVisible({ timeout: 30_000 });
  await shot('6-autoeq');
  await page.getByTestId('autoeq-results').getByRole('button').first().click();
  await expect(dialog).toHaveCount(0, { timeout: 30_000 });
  const state = await value<HeadphoneState>('headphones.state');
  expect(state.measurements.at(-1)).toMatchObject({ source: 'oratory1990', hasCurve: true, hasPreset: true });
  await page.getByRole('button', { name: 'Use this preset' }).click();
  await expect
    .poll(async () => (await value<{ eq: { preamp: { auto: boolean } } }>('player.state')).eq.preamp.auto)
    .toBe(false);
  await page.getByTestId('hp-target-menu').click();
  await page.getByRole('menuitem', { name: 'Fetch from AutoEq' }).click();
  await page.getByRole('menuitem', { name: /^Harman over-ear 2018/ }).click();
  await expect(page.getByTestId('hp-target')).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByText(/Harman over-ear 2018 is approximate here/)).toBeVisible();
  await shot('7-live');
});
