/*
 * The media overlay, hotkeys and mini player through the whole app, on the generated library, silently with --ao=null.
 * The overlay is read back from Windows, looking only at this app's session: foobar2000 may be the one that's current.
 * Real key presses are Levan's to try. Writes to .dev/e2e-input/, and screenshots to .dev/screenshots/phase5/.
 */
import { execFile } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import type { PlayerPosition, PlayerState, ScanState, Track, WindowState } from '@shared/domain';
import { launchApp, resizeWindow, ROOT, settled, stubFolderDialog } from './helpers/app';
import { generatedLibrary } from './helpers/generatedLibrary';

const E2E = join(ROOT, '.dev', 'e2e-input');
const MUSIC = join(E2E, 'Music');
const SCREENSHOTS = join(ROOT, '.dev', 'screenshots', 'phase5');
const SESSION_NAME = 'musicplayer';

const run = promisify(execFile);

test.describe.configure({ mode: 'serial' });

let app: ElectronApplication;
let page: Page;
let tracks: Track[];
const problems: string[] = [];

function watchForProblems(target: Page) {
  target.on('console', (message) => {
    if (message.type() === 'error') problems.push(`${test.info().title}: ${message.text()}`);
  });
  target.on('pageerror', (error) => problems.push(`${test.info().title}: ${error.message}`));
}

async function value<T>(name: string, input?: unknown, from: Page = page): Promise<T> {
  const result = (await from.evaluate(
    ([command, args]) =>
      (window.api.invoke as (...values: unknown[]) => Promise<unknown>)(command, ...(args === undefined ? [] : [args])),
    [name, input] as const,
  )) as { ok: true; value: T } | { ok: false; error: { message: string } };
  if (!result.ok) throw new Error(`${name}: ${result.error.message}`);
  return result.value;
}

const state = () => value<PlayerState>('player.state');
const positionMs = async () => (await value<PlayerPosition>('player.position')).positionMs;
const windowState = () => value<WindowState>('window.state');

const until = (check: (current: PlayerState) => boolean) =>
  expect.poll(async () => check(await state()), { timeout: 15_000, intervals: [20] }).toBe(true);

type Session = {
  title: string;
  artist: string;
  album: string;
  thumbnailBytes: number;
  status: string;
  canNext: boolean;
  canSeek: boolean;
  endSeconds: number;
};

/** Every session is looked through, and only this app's is read or sent anything. */
async function ownSession(action = ''): Promise<Session | null> {
  const script = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
[void][Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
$manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
foreach ($s in $manager.GetSessions()) {
  if ($s.SourceAppUserModelId -notmatch '${SESSION_NAME}') { continue }
  ${action}
  $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  $bytes = 0
  if ($p.Thumbnail) {
    $stream = Await ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    $memory = New-Object System.IO.MemoryStream
    [System.IO.WindowsRuntimeStreamExtensions].GetMethod('AsStream', [type[]]@([Windows.Storage.Streams.IRandomAccessStream])).Invoke($null, @($stream)).CopyTo($memory)
    $bytes = $memory.Length
  }
  $i = $s.GetPlaybackInfo(); $t = $s.GetTimelineProperties()
  [pscustomobject]@{ title = $p.Title; artist = $p.Artist; album = $p.AlbumTitle; thumbnailBytes = [int]$bytes; status = "$($i.PlaybackStatus)"; canNext = $i.Controls.IsNextEnabled; canSeek = $i.Controls.IsPlaybackPositionEnabled; endSeconds = $t.EndTime.TotalSeconds } | ConvertTo-Json -Compress
}
`;
  const { stdout } = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  });
  const line = stdout.split(/\r?\n/).find((text) => text.startsWith('{'));
  return line === undefined ? null : (JSON.parse(line) as Session);
}

const mainWindowVisible = () =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some((win) => win.isVisible() && win.getMinimumSize()[0] === 640),
  );

async function openMini(): Promise<Page> {
  const opened = app.waitForEvent('window');
  await page.keyboard.press('Control+m');
  const mini = await opened;
  watchForProblems(mini);
  await mini.getByTestId('mini-player').waitFor();
  await expect.poll(mainWindowVisible).toBe(false);
  return mini;
}

const windowCount = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);

/** The window goes as the key goes down, so Playwright's key up has nowhere to land. */
async function closeWithKey(mini: Page, key: string): Promise<void> {
  await mini.keyboard.press(key).catch(() => {});
  await expect.poll(windowCount).toBe(1);
}

test.beforeAll(async () => {
  test.setTimeout(300_000);
  rmSync(E2E, { recursive: true, force: true });
  mkdirSync(E2E, { recursive: true });
  mkdirSync(SCREENSHOTS, { recursive: true });
  await generatedLibrary(MUSIC);

  app = await launchApp({ userData: join(E2E, 'user-data'), dataRoot: join(E2E, 'data') });
  page = await app.firstWindow();
  watchForProblems(page);
  await page.waitForLoadState('load');
  await resizeWindow(app, page, 1280, 800);
  await stubFolderDialog(app, MUSIC);
  await page.getByRole('button', { name: 'Choose a folder' }).click();
  await expect
    .poll(async () => (await value<ScanState>('scan.state')).phase, { timeout: 120_000, intervals: [100] })
    .toBe('idle');

  const all = await value<Track[]>('library.tracks', { filter: { kind: 'all' } });
  tracks = all.filter((track) => track.artHash !== null && track.durationMs > 60_000).slice(0, 5);
  expect(tracks.length).toBeGreaterThanOrEqual(3);
  await value('player.play', { trackIds: tracks.map(({ id }) => id), startIndex: 1 });
  await until((current) => current.status === 'playing');
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
});

test('the transport keys drive the player', async () => {
  await page.locator('body').click({ position: { x: 5, y: 5 } });

  await page.keyboard.press('Space');
  await until(({ status }) => status === 'paused');
  await page.keyboard.press('Space');
  await until(({ status }) => status === 'playing');

  await value('player.seek', { positionMs: 40_000 });
  const before = await positionMs();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await positionMs()) - before).toBeGreaterThanOrEqual(4_500);
  const afterForward = await positionMs();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(positionMs).toBeLessThan(afterForward);

  const beforeFar = await positionMs();
  await page.keyboard.press('Shift+ArrowLeft');
  await expect.poll(async () => beforeFar - (await positionMs())).toBeGreaterThan(20_000);

  await page.keyboard.press('Control+ArrowRight');
  await until(({ queueIndex }) => queueIndex === 2);
  await page.keyboard.press('Control+ArrowLeft');
  await until(({ queueIndex }) => queueIndex === 1);

  const { volume } = await state();
  await page.keyboard.press('-');
  await until((current) => current.volume === volume - 5);
  await page.keyboard.press('+');
  await until((current) => current.volume === volume);
  await page.keyboard.press('m');
  await until(({ muted }) => muted);
  await page.keyboard.press('m');
  await until(({ muted }) => !muted);

  await page.keyboard.press('Control+Shift+E');
  await until(({ outputMode }) => outputMode === 'exclusive');
  await page.keyboard.press('Control+Shift+E');
  await until(({ outputMode }) => outputMode === 'shared');
});

test('typing in search keeps every key it uses', async () => {
  const field = page.getByRole('searchbox', { name: 'Search your library' });
  const before = await state();

  await page.keyboard.press('Control+f');
  await expect(field).toBeFocused();
  await page.keyboard.type('m q / ');
  await expect(field).toHaveValue('m q / ');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Control+ArrowLeft');
  await expect(field).toBeFocused();

  const after = await state();
  expect(after.muted).toBe(before.muted);
  expect(after.status).toBe('playing');
  expect(after.queueIndex).toBe(before.queueIndex);

  await page.keyboard.press('Escape');
  await expect(field).toHaveValue('');
  await page.locator('body').click({ position: { x: 5, y: 5 } });

  await page.keyboard.press('/');
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
});

test('a focused control keeps Space, and the slider its arrows', async () => {
  const mute = page.getByRole('button', { name: 'Mute', exact: true });
  await mute.focus();
  await page.keyboard.press('Space');
  await until(({ muted, status }) => muted && status === 'playing');
  await page.keyboard.press('Space');
  await until(({ muted }) => !muted);

  const volume = page.getByRole('slider', { name: 'Volume' });
  await volume.focus();
  const { volume: level } = await state();
  await page.keyboard.press('ArrowLeft');
  await until((current) => current.volume < level);
  await page.keyboard.press('Space');
  await until(({ status }) => status === 'paused');
  await page.keyboard.press('Space');
  await until(({ status }) => status === 'playing');
  await value('player.setVolume', { volume: level });
  await page.locator('body').click({ position: { x: 5, y: 5 } });
});

test('the other keys go where they say', async () => {
  await page.keyboard.press('q');
  await expect(page.getByRole('tab', { name: 'Queue', exact: true })).toHaveAttribute('data-state', 'active');
  await page.locator('body').click({ position: { x: 5, y: 5 } });

  await page.keyboard.press('Control+,');
  await expect(page.getByRole('button', { name: 'Settings' })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Settings' })).toHaveAttribute('aria-pressed', 'false');

  await page.keyboard.press('Shift+?');
  await expect(page.getByTestId('hotkey-list')).toBeVisible();
  await settled(page);
  await page.screenshot({ path: join(SCREENSHOTS, 'help-1280x800.png') });
  await page.keyboard.press('m');
  expect((await state()).muted).toBe(false);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('hotkey-list')).toBeHidden();
  await page.locator('body').click({ position: { x: 5, y: 5 } });

  await page.keyboard.press('F11');
  await expect.poll(async () => (await windowState()).isFullscreen).toBe(true);
  await page.keyboard.press('F11');
  await expect.poll(async () => (await windowState()).isFullscreen).toBe(false);
  await resizeWindow(app, page, 1280, 800);
});

test('Windows sees the session, with the art', async () => {
  const { current } = await state();
  await expect.poll(async () => (await ownSession())?.title, { timeout: 15_000 }).toBe(current?.title);
  await expect.poll(async () => (await ownSession())?.thumbnailBytes ?? 0, { timeout: 15_000 }).toBeGreaterThan(0);

  const session = await ownSession();
  expect(session).toMatchObject({ artist: current?.artist, album: current?.album, status: 'Playing', canNext: true });
  expect(session?.endSeconds).toBeCloseTo((current?.durationMs ?? 0) / 1000, 0);
  expect(session?.canSeek).toBe(true);
});

test('the overlay follows the player, and its buttons reach it', async () => {
  await value('player.pause');
  await expect.poll(async () => (await ownSession())?.status, { timeout: 15_000 }).toBe('Paused');
  expect(await page.evaluate(() => navigator.mediaSession.playbackState)).toBe('paused');

  await ownSession('[void](Await ($s.TryPlayAsync()) ([bool]))');
  await until(({ status }) => status === 'playing');
  await ownSession('[void](Await ($s.TryPauseAsync()) ([bool]))');
  await until(({ status }) => status === 'paused');
  await ownSession('[void](Await ($s.TrySkipNextAsync()) ([bool]))');
  await until(({ queueIndex }) => queueIndex === 2);
  await ownSession('[void](Await ($s.TryChangePlaybackPositionAsync(300000000)) ([bool]))');
  await expect.poll(positionMs).toBeGreaterThanOrEqual(29_000);
  await value('player.resume');
  await until(({ status }) => status === 'playing');
});

test('the mini player opens over a hidden main window, and the session stays', async () => {
  const mini = await openMini();

  const { current } = await state();
  await expect(mini.getByTestId('mini-title')).toHaveText(current?.title ?? '');
  expect((await windowState()).isMiniPlayer).toBe(true);
  expect(
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((win) => win.isAlwaysOnTop())),
  ).toBe(true);

  await expect.poll(async () => (await ownSession())?.status, { timeout: 15_000 }).toBe('Playing');

  await mini.getByRole('button', { name: 'Pause' }).click();
  await until(({ status }) => status === 'paused');
  await expect.poll(async () => (await ownSession())?.status, { timeout: 15_000 }).toBe('Paused');
  await mini.getByRole('button', { name: 'Play' }).click();
  await until(({ status }) => status === 'playing');

  await mini.getByRole('button', { name: 'Next' }).click();
  await until(({ queueIndex }) => queueIndex === 3);
  await mini.getByRole('button', { name: 'Previous' }).click();
  await until(({ queueIndex }) => queueIndex === 2);

  await mini.keyboard.press('m');
  await until(({ muted }) => muted);
  await mini.keyboard.press('m');
  await until(({ muted }) => !muted);

  await value('player.seek', { positionMs: 60_000 });
  const width = async () =>
    mini.getByTestId('mini-progress').evaluate((line) => line.firstElementChild?.getBoundingClientRect().width ?? 0);
  await expect.poll(width).toBeGreaterThan(0);

  // Over the app's own click, so a drag isn't needed to prove where it's remembered.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((candidate) => candidate.isAlwaysOnTop());
    win?.setPosition(120, 90);
    win?.emit('moved');
  });

  await mini
    .getByRole('button', { name: 'Return to the main window' })
    .first()
    .click()
    .catch(() => {}); // It takes the page with it.
  await expect.poll(windowCount).toBe(1);
  await expect.poll(mainWindowVisible).toBe(true);
  expect((await windowState()).isMiniPlayer).toBe(false);
  expect((await windowState()).isHidden).toBe(false);
});

test('it comes back where it was left, and closing it returns too', async () => {
  const mini = await openMini();
  const bounds = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((win) => win.isAlwaysOnTop())
      ?.getBounds(),
  );
  expect(bounds).toMatchObject({ x: 120, y: 90 });

  await closeWithKey(mini, 'Control+m');
  await expect.poll(mainWindowVisible).toBe(true);

  await closeWithKey(await openMini(), 'Escape');
  await expect.poll(mainWindowVisible).toBe(true);

  await openMini();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((win) => win.isAlwaysOnTop())
      ?.close(),
  );
  await expect.poll(windowCount).toBe(1);
  await expect.poll(mainWindowVisible).toBe(true);
});

test('the security rules hold in the mini too', async () => {
  const mini = await openMini();
  expect(await mini.evaluate(() => location.hash)).toBe('#/mini');

  const left = await mini.evaluate(() => window.open('https://example.com'));
  expect(left).toBeNull();

  await mini
    .getByRole('button', { name: 'Return to the main window' })
    .first()
    .click()
    .catch(() => {}); // It takes the page with it.
  await expect.poll(windowCount).toBe(1);
});

test('the mini player, as it looks', async () => {
  const mini = await openMini();
  await value('player.seek', { positionMs: 60_000 });
  await settled(mini);
  await mini.screenshot({ path: join(SCREENSHOTS, 'mini-100.png') });
  await closeWithKey(mini, 'Control+m');

  await value('settings.update', { uiScale: 2 });
  const bigger = await openMini();
  await settled(bigger);
  await bigger.screenshot({ path: join(SCREENSHOTS, 'mini-200.png') });
  await closeWithKey(bigger, 'Control+m');
  await value('settings.update', { uiScale: 1 });
});

test('quitting from the mini player quits the app', async () => {
  await openMini();
  const closed = new Promise((resolve) => app.process().once('exit', resolve));
  await app.evaluate(({ app: electronApp }) => electronApp.quit());
  await expect(closed).resolves.toBeDefined();

  expect(problems).toEqual([]);
});
