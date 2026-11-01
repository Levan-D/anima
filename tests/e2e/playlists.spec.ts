/*
 * Playlists through the whole UI, on the generated library, silently with --ao=null: making one, adding to it, the drag
 * by mouse and finger, missing tracks, and all of it surviving a relaunch. Screenshots go to .dev/screenshots/phase4/.
 */
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Locator, Page } from 'playwright';
import type { PlayerState, PlaylistDetail, PlaylistSummary, QueueItem, ScanState } from '@shared/domain';
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

const E2E = join(ROOT, '.dev', 'e2e-playlists');
const MUSIC = join(E2E, 'Music');
const SCREENSHOTS = join(ROOT, '.dev', 'screenshots', 'phase4');
const SIZES = [
  { name: '1280x800', width: 1280, height: 800 },
  { name: '1920x1080', width: 1920, height: 1080 },
];

let app: ElectronApplication;
let page: Page;
const problems: string[] = [];

function watchForProblems(target: Page) {
  target.on('console', (message) => {
    if (message.type() === 'error' && !message.location().url.startsWith('art://')) {
      problems.push(`${test.info().title}: ${message.text()}`);
    }
  });
  target.on('pageerror', (error) => problems.push(`${test.info().title}: ${error.message}`));
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

async function start(): Promise<void> {
  app = await launchApp({ userData: join(E2E, 'user-data'), dataRoot: join(E2E, 'data') });
  page = await app.firstWindow();
  watchForProblems(page);
  await page.waitForLoadState('load');
  await resizeWindow(app, page, 1280, 800);
}

const waitForIdleScan = () =>
  expect
    .poll(async () => (await value<ScanState>('scan.state')).phase, { timeout: 120_000, intervals: [100] })
    .toBe('idle');

const tab = (name: string) => page.getByRole('tab', { name, exact: true });
const rows = () => page.getByTestId('list-row');
const row = (title: string) => rows().filter({ hasText: title }).first();

async function titles(): Promise<string[]> {
  const detail = await currentPlaylist();
  return detail.items.map(({ track }) => track.title);
}

let playlistId = 0;
const currentPlaylist = () => value<PlaylistDetail>('playlist.get', { playlistId });

async function album(title: string): Promise<void> {
  await tab('Albums').click();
  await page.getByRole('searchbox').fill(title);
  await rows().filter({ hasText: title }).first().click();
  await expect(page.locator('header h1')).toHaveText(title);
}

async function dismissToasts(): Promise<void> {
  const dismiss = page.getByRole('button', { name: 'Dismiss' });
  while ((await dismiss.count()) > 0) {
    await dismiss
      .first()
      .click({ timeout: 1_000 })
      .catch(() => {});
  }
}

async function center(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('It has no box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function dragByMouse(from: Locator, to: { x: number; y: number }): Promise<void> {
  const start = await center(from);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x, start.y + 10, { steps: 2 });
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await settled(page);
  await page.mouse.up();
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(300_000);
  rmSync(E2E, { recursive: true, force: true });
  mkdirSync(SCREENSHOTS, { recursive: true });
  await generatedLibrary(MUSIC);
  await start();
  await stubFolderDialog(app, MUSIC);
  await page.getByRole('button', { name: 'Choose a folder' }).click();
  await page.getByRole('tab', { name: 'Albums', exact: true }).click();
  await tab('Albums').waitFor();
  await waitForIdleScan();
});

test.afterAll(async () => {
  await app.close();
});

test('with no playlists, the tab says so and offers to make one, whose name dialog opens under the CSP', async () => {
  await tab('Playlists').click();
  await expect(page.getByText('No playlists yet')).toBeVisible();
  await page.getByRole('button', { name: 'New playlist' }).click();

  const dialog = page.getByRole('dialog', { name: 'New playlist' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('textbox')).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Create' })).toBeDisabled();
  await page.keyboard.type('Long drive');
  await page.keyboard.press('Enter');

  await expect(dialog).toBeHidden();
  await expect(page.locator('header h1')).toHaveText('Long drive');
  await expect(page.getByText('Nothing in here yet')).toBeVisible();
  // The scroll lock's style tag has a hash in the CSP, and it says so here if an upgrade changes it.
  expect(problems).toEqual([]);

  const [created] = await value<PlaylistSummary[]>('playlist.list');
  playlistId = created?.id ?? 0;
  expect(playlistId).toBeGreaterThan(0);
});

test('tracks go in through the track menu, including into a new playlist from there', async () => {
  await album('Homogénic');

  for (const title of ['Jóga', 'Hunter', 'Bachelorette', 'Unravel']) {
    await row(title).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Add to playlist' }).click();
    await page.getByRole('menuitem', { name: 'Long drive' }).click();
    await expect(page.getByRole('menu')).toHaveCount(0);
  }
  await expect.poll(titles).toEqual(['Jóga', 'Hunter', 'Bachelorette', 'Unravel']);

  // A track goes in once, and it says so.
  await row('Jóga').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Add to playlist' }).click();
  await page.getByRole('menuitem', { name: 'Long drive' }).click();
  await expect(page.getByText('Already in Long drive', { exact: true })).toBeVisible();
  await expect.poll(titles).toEqual(['Jóga', 'Hunter', 'Bachelorette', 'Unravel']);

  await row('Unravel').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Add to playlist' }).click();
  await page.getByRole('menuitem', { name: 'New playlist…' }).click();
  const dialog = page.getByRole('dialog', { name: 'New playlist' });
  await expect(dialog.getByRole('textbox')).toBeFocused();
  await page.keyboard.type('long DRIVE');
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('alert')).toContainText('already');
  await dialog.getByRole('textbox').fill('Second');
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  // It hasn't left the pointer dead: what the menu and the dialog disabled between them came back.
  expect(await page.evaluate(() => document.body.style.pointerEvents)).not.toBe('none');

  const lists = await value<PlaylistSummary[]>('playlist.list');
  expect(lists.map(({ name, trackCount }) => [name, trackCount])).toEqual([
    ['Long drive', 4],
    ['Second', 1],
  ]);
  await dismissToasts();
});

test('the list shows them, and a row opens one, with art from its first track', async () => {
  await tab('Playlists').click();
  await expect(rows()).toHaveCount(2);
  await expect(row('Long drive')).toContainText('4 tracks');
  await row('Long drive').click();
  await expect(page.locator('header h1')).toHaveText('Long drive');
  await expect(page.locator('header img').first()).toHaveAttribute('src', /^art:\/\//);
  await expect(rows()).toHaveCount(4);
});

test('a mouse drags a row anywhere, rows open a gap where it will land, and a plain click still only picks', async () => {
  const before = await value<PlayerState>('player.state');
  await rows().nth(0).click();
  await expect.poll(async () => (await value<PlayerState>('player.state')).loadId).toBe(before.loadId);

  const target = await rows().nth(3).boundingBox();
  if (!target) throw new Error('No row');
  const firstAt = await rows().nth(0).boundingBox();
  const startAt = await center(rows().nth(0));
  await page.mouse.move(startAt.x, startAt.y);
  await page.mouse.down();
  await page.mouse.move(startAt.x, startAt.y + 10, { steps: 2 });
  await page.mouse.move(startAt.x, target.y + target.height - 2, { steps: 5 });
  await settled(page);

  await expect(page.getByTestId('drag-overlay')).toBeVisible();
  expect(await rows().nth(0).getAttribute('data-dragging')).not.toBeNull();
  // The next row has slid up into the place it left.
  await expect.poll(async () => (await rows().nth(1).boundingBox())?.y).toBe(firstAt?.y);
  await page.screenshot({ path: join(SCREENSHOTS, 'dragging-1280x800.png') });

  await page.mouse.up();
  await expect.poll(titles).toEqual(['Hunter', 'Bachelorette', 'Unravel', 'Jóga']);
  await expect(page.getByTestId('drag-overlay')).toBeHidden();
  await expect(rows().nth(3)).toContainText('Jóga');
  expect(await page.locator('[data-dragging], [data-sliding]').count()).toBe(0);
  // Letting go isn't a click on the row underneath.
  expect((await value<PlayerState>('player.state')).loadId).toBe(before.loadId);
});

test('Escape abandons a drag, without going back a place', async () => {
  const startAt = await center(rows().nth(0));
  await page.mouse.move(startAt.x, startAt.y);
  await page.mouse.down();
  await page.mouse.move(startAt.x, startAt.y + 80, { steps: 4 });
  await settled(page);
  await page.keyboard.press('Escape');
  await page.mouse.up();

  await expect(page.locator('header h1')).toHaveText('Long drive');
  await expect(page.getByTestId('drag-overlay')).toBeHidden();
  expect(await titles()).toEqual(['Hunter', 'Bachelorette', 'Unravel', 'Jóga']);
});

test('a finger drags by the handle, and on the row it does not', async () => {
  const session = await page.context().newCDPSession(page);
  const touch = (type: string, at: { x: number; y: number } | null) =>
    session.send('Input.dispatchTouchEvent', {
      type: type as 'touchStart',
      touchPoints: at ? [at] : [],
    });

  const handle = rows().nth(2).locator('[data-drag-handle]');
  const from = await center(handle);
  const onto = await center(rows().nth(0));
  await touch('touchStart', from);
  await touch('touchMove', { x: from.x, y: from.y - 20 });
  await touch('touchMove', { x: from.x, y: onto.y - 10 });
  await settled(page);
  await expect(page.getByTestId('drag-overlay')).toBeVisible();
  await touch('touchEnd', null);
  await expect.poll(titles).toEqual(['Unravel', 'Hunter', 'Bachelorette', 'Jóga']);

  // A tap on the handle isn't a tap on the row.
  const before = await value<PlayerState>('player.state');
  const tapAt = await center(rows().nth(1).locator('[data-drag-handle]'));
  await touch('touchStart', tapAt);
  await touch('touchEnd', null);
  await page.waitForTimeout(150);
  expect((await value<PlayerState>('player.state')).loadId).toBe(before.loadId);
});

test('Move up and Move down are in the menu for the keyboard', async () => {
  await rows().nth(1).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move down' }).click();
  await expect.poll(titles).toEqual(['Unravel', 'Bachelorette', 'Hunter', 'Jóga']);

  await rows().nth(0).click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Move up' })).toHaveAttribute('data-disabled', '');
  await page.keyboard.press('Escape');
  await expect(page.locator('header h1')).toHaveText('Long drive');
});

test('renaming keeps its name when the new one is taken, and takes it when it is not', async () => {
  await page.getByRole('button', { name: 'Playlist actions' }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rename playlist' });
  await expect(dialog.getByRole('textbox')).toHaveValue('Long drive');
  await dialog.getByRole('textbox').fill('Second');
  await dialog.getByRole('button', { name: 'Rename' }).click();
  await expect(dialog.getByRole('alert')).toContainText('already');
  await dialog.getByRole('textbox').fill('Night drive');
  await dialog.getByRole('button', { name: 'Rename' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('header h1')).toHaveText('Night drive');
});

test('playing a row leaves what is missing out of the queue, from the right place', async () => {
  rmSync(join(MUSIC, 'Björk', 'Homogénic', '1-03 Bachelorette.flac'));
  await tab('Albums').click();
  await openSettingsTab(page, 'Library');
  await page.getByRole('button', { name: 'Rescan' }).click();
  await waitForIdleScan();
  await closeSettings(page);
  await dismissToasts();
  await tab('Playlists').click();
  await row('Night drive').click();

  await expect(page.getByRole('heading', { name: 'Not on this device' })).toBeVisible();
  expect((await currentPlaylist()).missingCount).toBe(1);
  // Still in the stored order, for when it comes back. On screen it's last, and grey.
  expect(await titles()).toEqual(['Unravel', 'Bachelorette', 'Hunter', 'Jóga']);
  const shown = rows().nth(3);
  await expect(shown).toContainText('Bachelorette');
  await expect(shown).toHaveAttribute('aria-disabled', 'true');

  await rows().nth(2).dblclick();
  await expect.poll(async () => (await value<PlayerState>('player.state')).status).toBe('playing');
  const playing = await value<PlayerState>('player.state');
  expect(playing.queueLength).toBe(3);
  expect(playing.queueIndex).toBe(2);
  const queue = await value<QueueItem[]>('player.queue');
  expect(queue.map(({ track }) => track.title)).toEqual(['Unravel', 'Hunter', 'Jóga']);
  await page.waitForTimeout(100);
  await value<void>('player.pause');
});

test('a drag lands past the missing row in the stored order, not on it', async () => {
  const hunterAt = await center(rows().nth(1));
  const endOfPlayable = await rows().nth(2).boundingBox();
  if (!endOfPlayable) throw new Error('No row');
  await dragByMouse(rows().nth(1), { x: hunterAt.x, y: endOfPlayable.y + endOfPlayable.height - 2 });
  await expect
    .poll(async () =>
      (await currentPlaylist()).items.filter(({ track }) => !track.isMissing).map(({ track }) => track.title),
    )
    .toEqual(['Unravel', 'Jóga', 'Hunter']);
  expect((await currentPlaylist()).items).toHaveLength(4);
});

test('the Queue tab drags the same way, through the player', async () => {
  await page.getByRole('button', { name: 'Queue', exact: true }).click();
  await expect(rows()).toHaveCount(3);
  const before = (await value<QueueItem[]>('player.queue')).map(({ queueId }) => queueId);
  const startAt = await center(rows().nth(0));
  const target = await rows().nth(2).boundingBox();
  if (!target) throw new Error('No row');
  await dragByMouse(rows().nth(0), { x: startAt.x, y: target.y + target.height - 2 });
  await expect
    .poll(async () => (await value<QueueItem[]>('player.queue')).map(({ queueId }) => queueId))
    .toEqual([before[1], before[2], before[0]]);
});

test('auto-scroll carries a drag past what fits on screen', async () => {
  const fieldId = await value<{ id: number }[]>('library.tracks', { filter: { kind: 'all' } });
  const made = await value<PlaylistSummary>('playlist.create', {
    name: 'Long list',
    trackIds: fieldId.slice(0, 80).map(({ id }) => id),
  });
  await tab('Playlists').click();
  await row('Long list').click();
  await expect(page.locator('header h1')).toHaveText('Long list');
  const firstId = (await value<PlaylistDetail>('playlist.get', { playlistId: made.id })).items[0]?.itemId;

  const scroller = page.getByTestId('list-scroller');
  const box = await scroller.boundingBox();
  if (!box) throw new Error('No scroller');
  const startAt = await center(rows().nth(0));
  await page.mouse.move(startAt.x, startAt.y);
  await page.mouse.down();
  await page.mouse.move(startAt.x, startAt.y + 10, { steps: 2 });
  await page.mouse.move(startAt.x, box.y + box.height - 4, { steps: 4 });
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop), { timeout: 10_000 }).toBeGreaterThan(300);
  await page.mouse.up();

  await expect(page.getByTestId('drag-overlay')).toBeHidden();
  expect(await page.locator('[data-dragging], [data-sliding]').count()).toBe(0);

  const after = (await value<PlaylistDetail>('playlist.get', { playlistId: made.id })).items;
  expect(after.findIndex(({ itemId }) => itemId === firstId)).toBeGreaterThan(5);

  // The list keeps the focused row in view for a moment after it lands.
  await expect(async () => {
    await scroller.evaluate((element) => element.scrollTo({ top: 0 }));
    await settled(page);
    expect(await scroller.evaluate((element) => element.scrollTop)).toBe(0);
  }).toPass();
  const listed = (await value<PlaylistDetail>('playlist.get', { playlistId: made.id })).items;
  await row(listed[1]?.track.title ?? '').click();
  await row(listed[3]?.track.title ?? '').click({ modifiers: ['Control'] });
  const selected = page.locator('[data-testid="list-row"][aria-pressed]');
  await expect(selected).toHaveCount(2);
  const before = listed.map(({ itemId }) => itemId);
  const groupAt = await center(selected.first());
  const rowHeight = (await selected.first().boundingBox())?.height ?? 0;
  await page.mouse.move(groupAt.x, groupAt.y);
  await page.mouse.down();
  await page.mouse.move(groupAt.x, groupAt.y + 30, { steps: 3 });
  await page.mouse.move(groupAt.x, groupAt.y + rowHeight * 3, { steps: 4 });
  await settled(page);
  await expect(page.getByTestId('drag-count')).toHaveText('2');
  await page.waitForTimeout(350);
  await page.screenshot({ path: join(SCREENSHOTS, 'dragging-group-1280x800.png') });
  await page.mouse.up();
  await expect
    .poll(async () =>
      (await value<PlaylistDetail>('playlist.get', { playlistId: made.id })).items.map(({ itemId }) => itemId),
    )
    .not.toEqual(before);
  await expect(page.getByTestId('drag-overlay')).toBeHidden();
  const [first, second] = await Promise.all([selected.nth(0).boundingBox(), selected.nth(1).boundingBox()]);
  expect((second?.y ?? 0) - (first?.y ?? 0)).toBe(rowHeight);
  await page.keyboard.press('Escape');

  await value<void>('playlist.delete', { playlistId: made.id });
  await page.getByRole('button', { name: 'Back' }).first().click();
});

test('Remove missing warns first, and only then removes', async () => {
  await row('Night drive').click();
  await page.getByRole('button', { name: 'Remove missing' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('1 track');
  await dialog.getByRole('button', { name: 'Keep them' }).click();
  await expect(dialog).toBeHidden();
  expect((await currentPlaylist()).missingCount).toBe(1);
});

test('one pass of screenshots', async () => {
  for (const { name, width, height } of SIZES) {
    await resizeWindow(app, page, width, height);
    await page.screenshot({ path: join(SCREENSHOTS, `detail-${name}.png`) });
  }
  await page.getByRole('button', { name: 'Back' }).first().click();
  for (const { name, width, height } of SIZES) {
    await resizeWindow(app, page, width, height);
    await page.screenshot({ path: join(SCREENSHOTS, `list-${name}.png`) });
  }
  await resizeWindow(app, page, 1280, 800);
  await row('Night drive').click();
  await rows().nth(0).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Add to playlist' }).click();
  await settled(page);
  await page.screenshot({ path: join(SCREENSHOTS, 'menu-1280x800.png') });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.getByRole('button', { name: 'Remove missing' }).click();
  await settled(page);
  await page.screenshot({ path: join(SCREENSHOTS, 'remove-missing-1280x800.png') });
  await page.getByRole('dialog').getByRole('button', { name: 'Keep them' }).click();
});

test('everything survives a relaunch, missing track and order included', async () => {
  const before = await currentPlaylist();
  await app.close();
  await start();
  await tab('Playlists').click();
  await row('Night drive').click();
  await expect(page.locator('header h1')).toHaveText('Night drive');
  await expect(page.getByRole('heading', { name: 'Not on this device' })).toBeVisible();

  const after = await currentPlaylist();
  expect(after.items.map(({ itemId }) => itemId)).toEqual(before.items.map(({ itemId }) => itemId));
  expect(after.missingCount).toBe(1);

  // Now it goes, for real, and then the whole playlist.
  await page.getByRole('button', { name: 'Remove missing' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove them' }).click();
  await expect(page.getByRole('heading', { name: 'Not on this device' })).toBeHidden();
  expect((await currentPlaylist()).items).toHaveLength(3);

  await page.getByRole('button', { name: 'Playlist actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete Night drive?' });
  await confirm.getByRole('button', { name: 'Keep it' }).click();
  await expect(confirm).toBeHidden();
  expect((await value<PlaylistSummary[]>('playlist.list')).map(({ name }) => name)).toContain('Night drive');

  await page.getByRole('button', { name: 'Playlist actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete it' }).click();
  await expect(rows()).toHaveCount(1);
  await expect(row('Second')).toBeVisible();
  expect(problems).toEqual([]);
});
