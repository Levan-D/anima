import { app, dialog, type WebContents } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createReloadGuard, startCrashRecovery } from '@main/system/crashRecovery';

vi.mock('electron', () => ({
  app: { on: vi.fn(), quit: vi.fn() },
  BrowserWindow: { fromWebContents: () => null },
  dialog: { showMessageBox: vi.fn() },
}));
vi.mock('@main/system/logging', () => ({ log: { error: vi.fn() } }));

describe('createReloadGuard', () => {
  it('allows a few reloads', () => {
    const mayReload = createReloadGuard(3, 60_000);
    expect([mayReload(0), mayReload(1), mayReload(2)]).toEqual([true, true, true]);
  });

  it('stops a crash loop', () => {
    const mayReload = createReloadGuard(3, 60_000);
    mayReload(0);
    mayReload(1);
    mayReload(2);
    expect(mayReload(3)).toBe(false);
  });

  it('forgives once the crashes are old', () => {
    const mayReload = createReloadGuard(3, 60_000);
    mayReload(0);
    mayReload(1);
    mayReload(2);
    expect(mayReload(70_000)).toBe(true);
  });
});

describe('startCrashRecovery', () => {
  const reload = vi.fn();
  const contents = { isDestroyed: () => false, reload } as unknown as WebContents;

  type Listener = (event: unknown, contents: WebContents, details: { reason: string }) => void;

  function startAndGetListener(): Listener {
    startCrashRecovery();
    const [, listener] = vi.mocked(app.on).mock.lastCall as unknown as [string, Listener];
    return listener;
  }

  const crash = (listener: Listener, reason = 'crashed') => listener({}, contents, { reason });

  /** The dialog answers on a later tick, so wait for what it leads to. */
  const settle = () => new Promise((resolve) => setTimeout(resolve));

  beforeEach(() => {
    reload.mockClear();
    vi.mocked(app.quit).mockClear();
    vi.mocked(dialog.showMessageBox).mockReset();
  });

  it('reloads a crashed renderer without asking', () => {
    crash(startAndGetListener());
    expect(reload).toHaveBeenCalledOnce();
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
  });

  it('leaves a renderer alone when it exited on purpose', () => {
    crash(startAndGetListener(), 'clean-exit');
    expect(reload).not.toHaveBeenCalled();
  });

  it('asks once the reloads have run out, and reloads if that is the answer', async () => {
    vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 0, checkboxChecked: false });
    const listener = startAndGetListener();
    for (let crashes = 0; crashes < 3; crashes++) crash(listener);
    expect(reload).toHaveBeenCalledTimes(3);

    crash(listener);
    await settle();

    expect(dialog.showMessageBox).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledTimes(4);
    expect(app.quit).not.toHaveBeenCalled();
  });

  it('quits if that is the answer', async () => {
    vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 1, checkboxChecked: false });
    const listener = startAndGetListener();
    for (let crashes = 0; crashes < 4; crashes++) crash(listener);
    await settle();

    expect(reload).toHaveBeenCalledTimes(3);
    expect(app.quit).toHaveBeenCalledOnce();
  });
});
