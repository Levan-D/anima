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
  await expect(page.getByRole('button', { name: 'Add songs' })).toBeVisible();
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

test('the page itself is read-only: a drag moves nothing, the menu has no moves, and a plain click only picks', async () => {
  const before = await value<PlayerState>('player.state');
  await rows().nth(0).click();
  await expect.poll(async () => (await value<PlayerState>('player.state')).loadId).toBe(before.loadId);

  const target = await rows().nth(3).boundingBox();
  if (!target) throw new Error('No row');
  const startAt = await center(rows().nth(0));
  await page.mouse.move(startAt.x, startAt.y);
  await page.mouse.down();
  await page.mouse.move(startAt.x, startAt.y + 10, { steps: 2 });
  await page.mouse.move(startAt.x, target.y + target.height - 2, { steps: 5 });
  await settled(page);
  await expect(page.getByTestId('drag-overlay')).toHaveCount(0);
  await page.mouse.up();
  expect(await titles()).toEqual(['Jóga', 'Hunter', 'Bachelorette', 'Unravel']);

  await rows().nth(1).click({ button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: 'Add to queue' })).toBeVisible();
  for (const name of ['Move up', 'Move down', 'Remove from playlist']) {
    await expect(menu.getByRole('menuitem', { name })).toHaveCount(0);
  }
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
});

const editor = () => page.getByRole('dialog', { name: 'Edit playlist' });
const nameField = () => editor().getByRole('textbox', { name: 'Playlist name' });
const pickedRows = () => editor().locator('[data-drag-id]');
// Each picked row has a button to take it out, named for it.
const picked = () =>
  editor()
    .locator('[data-drag-id] button[aria-label^="Take "]')
    .evaluateAll((buttons) => buttons.map((button) => (button.getAttribute('aria-label') ?? '').slice(5, -4)));

async function removeMissing(): Promise<void> {
  await page.getByRole('button', { name: 'Playlist actions' }).click();
  await page.getByRole('menuitem', { name: 'Remove missing…' }).click();
}

async function openEditor(): Promise<void> {
  await page.getByRole('button', { name: 'Playlist actions' }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  await expect(editor()).toBeVisible();
  await settled(page);
}

test('Edit is in the menu, and opens on the name with the songs already picked, in order', async () => {
  await openEditor();
  await expect(nameField()).toBeFocused();
  await expect(nameField()).toHaveValue('Long drive');
  await expect(editor().getByText('4 songs', { exact: true })).toBeVisible();
  expect(await picked()).toEqual(['Jóga', 'Hunter', 'Bachelorette', 'Unravel']);
  await page.screenshot({ path: join(SCREENSHOTS, 'editor-1280x800.png') });
});

test('in the editor a mouse drags a song anywhere, Escape drops a drag and nothing else, a finger drags by the handle, and Save keeps the order', async () => {
  const last = await pickedRows().nth(3).boundingBox();
  if (!last) throw new Error('No row');
  const from = await center(pickedRows().nth(0));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y + 10, { steps: 2 });
  await page.mouse.move(from.x, last.y + last.height - 2, { steps: 5 });
  await settled(page);
  await expect(page.getByTestId('drag-overlay')).toBeVisible();
  await page.screenshot({ path: join(SCREENSHOTS, 'editor-dragging-1280x800.png') });
  await page.mouse.up();
  await expect.poll(picked).toEqual(['Hunter', 'Bachelorette', 'Unravel', 'Jóga']);
  await expect(page.getByTestId('drag-overlay')).toBeHidden();

  const again = await center(pickedRows().nth(0));
  await page.mouse.move(again.x, again.y);
  await page.mouse.down();
  await page.mouse.move(again.x, again.y + 80, { steps: 4 });
  await settled(page);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.getByTestId('drag-overlay')).toBeHidden();
  await expect(editor()).toBeVisible();
  expect(await picked()).toEqual(['Hunter', 'Bachelorette', 'Unravel', 'Jóga']);

  const session = await page.context().newCDPSession(page);
  const touch = (type: string, at: { x: number; y: number } | null) =>
    session.send('Input.dispatchTouchEvent', { type: type as 'touchStart', touchPoints: at ? [at] : [] });
  const handle = await center(pickedRows().nth(2).locator('[data-drag-handle]'));
  const onto = await center(pickedRows().nth(0));
  await touch('touchStart', handle);
  await touch('touchMove', { x: handle.x, y: handle.y - 20 });
  await touch('touchMove', { x: handle.x, y: onto.y - 10 });
  await settled(page);
  await expect(page.getByTestId('drag-overlay')).toBeVisible();
  await touch('touchEnd', null);
  await expect.poll(picked).toEqual(['Unravel', 'Hunter', 'Bachelorette', 'Jóga']);

  const hunter = await center(pickedRows().nth(1));
  const bachelorette = await pickedRows().nth(2).boundingBox();
  if (!bachelorette) throw new Error('No row');
  await page.mouse.move(hunter.x, hunter.y);
  await page.mouse.down();
  await page.mouse.move(hunter.x, hunter.y + 10, { steps: 2 });
  await page.mouse.move(hunter.x, bachelorette.y + bachelorette.height - 2, { steps: 4 });
  await settled(page);
  await page.mouse.up();
  await expect.poll(picked).toEqual(['Unravel', 'Bachelorette', 'Hunter', 'Jóga']);

  // Nothing is stored until Save.
  expect(await titles()).toEqual(['Jóga', 'Hunter', 'Bachelorette', 'Unravel']);
  await editor().getByRole('button', { name: 'Save' }).click();
  await expect(editor()).toHaveCount(0);
  await expect.poll(titles).toEqual(['Unravel', 'Bachelorette', 'Hunter', 'Jóga']);
  await expect(rows().nth(0)).toContainText('Unravel');
});

test('taking a song out and then Cancel leaves the playlist as it was', async () => {
  await openEditor();
  await editor().getByRole('button', { name: 'Take Hunter out' }).click();
  await expect(editor().getByText('3 songs', { exact: true })).toBeVisible();
  await editor().getByRole('button', { name: 'Cancel' }).click();
  await expect(editor()).toHaveCount(0);
  expect(await titles()).toEqual(['Unravel', 'Bachelorette', 'Hunter', 'Jóga']);
});

test('renaming in the editor stays open when the name is taken, and saves when it is not', async () => {
  await openEditor();
  await nameField().fill('Second');
  await editor().getByRole('button', { name: 'Save' }).click();
  await expect(editor().getByRole('alert')).toContainText('already');
  await expect(editor()).toBeVisible();
  await nameField().fill('Night drive');
  await editor().getByRole('button', { name: 'Save' }).click();
  await expect(editor()).toHaveCount(0);
  await expect(page.locator('header h1')).toHaveText('Night drive');
  expect(await titles()).toEqual(['Unravel', 'Bachelorette', 'Hunter', 'Jóga']);
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

test('the editor keeps a missing song in its place, and a drag around it saves in that order', async () => {
  await openEditor();
  expect(await picked()).toEqual(['Unravel', 'Bachelorette', 'Hunter', 'Jóga']);
  const hunter = await center(pickedRows().nth(2));
  const last = await pickedRows().nth(3).boundingBox();
  if (!last) throw new Error('No row');
  await dragByMouse(pickedRows().nth(2), { x: hunter.x, y: last.y + last.height - 2 });
  await expect.poll(picked).toEqual(['Unravel', 'Bachelorette', 'Jóga', 'Hunter']);
  await editor().getByRole('button', { name: 'Save' }).click();
  await expect(editor()).toHaveCount(0);
  await expect
    .poll(async () =>
      (await currentPlaylist()).items.filter(({ track }) => !track.isMissing).map(({ track }) => track.title),
    )
    .toEqual(['Unravel', 'Jóga', 'Hunter']);
  expect((await currentPlaylist()).items).toHaveLength(4);
});

test('the queue sheet drags the same way, through the player', async () => {
  const sheet = page.getByRole('dialog', { name: 'Queue' });
  const queued = () => sheet.getByTestId('list-row');
  await page.getByRole('button', { name: 'Queue', exact: true }).first().click();
  await expect(queued()).toHaveCount(3);
  await settled(page);
  const before = (await value<QueueItem[]>('player.queue')).map(({ queueId }) => queueId);
  const startAt = await center(queued().nth(0));
  const target = await queued().nth(2).boundingBox();
  if (!target) throw new Error('No row');
  await dragByMouse(queued().nth(0), { x: startAt.x, y: target.y + target.height - 2 });
  await expect
    .poll(async () => (await value<QueueItem[]>('player.queue')).map(({ queueId }) => queueId))
    .toEqual([before[1], before[2], before[0]]);
  await page.getByRole('button', { name: 'Close queue' }).first().click();
  await expect(sheet).toHaveCount(0);
});

test('in the editor, a drag scrolls a long list past what fits', async () => {
  const fieldId = await value<{ id: number }[]>('library.tracks', { filter: { kind: 'all' } });
  const made = await value<PlaylistSummary>('playlist.create', {
    name: 'Long list',
    trackIds: fieldId.slice(0, 80).map(({ id }) => id),
  });
  await tab('Playlists').click();
  await row('Long list').click();
  await expect(page.locator('header h1')).toHaveText('Long list');
  const firstId = (await value<PlaylistDetail>('playlist.get', { playlistId: made.id })).items[0]?.track.id;

  await openEditor();
  const scroller = editor().locator('[data-scroller]');
  const box = await scroller.boundingBox();
  if (!box) throw new Error('No scroller');
  const startAt = await center(pickedRows().nth(0));
  await page.mouse.move(startAt.x, startAt.y);
  await page.mouse.down();
  await page.mouse.move(startAt.x, startAt.y + 10, { steps: 2 });
  await page.mouse.move(startAt.x, box.y + box.height - 4, { steps: 4 });
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop), { timeout: 10_000 }).toBeGreaterThan(300);
  await page.mouse.up();
  await expect(page.getByTestId('drag-overlay')).toBeHidden();
  expect(await page.locator('[data-dragging], [data-sliding]').count()).toBe(0);

  await editor().getByRole('button', { name: 'Save' }).click();
  await expect(editor()).toHaveCount(0);
  const after = (await value<PlaylistDetail>('playlist.get', { playlistId: made.id })).items;
  expect(after.findIndex(({ track }) => track.id === firstId)).toBeGreaterThan(5);

  await value<void>('playlist.delete', { playlistId: made.id });
  await page.getByRole('button', { name: 'Back' }).first().click();
});

test('Remove missing warns first, and only then removes', async () => {
  await row('Night drive').click();
  await removeMissing();
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
  await removeMissing();
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
  await removeMissing();
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
