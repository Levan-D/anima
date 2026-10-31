import type { BrowserWindow, ThumbarButton } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerState, Track } from '@shared/domain';
import { createThumbar } from './thumbar';

vi.mock('electron', () => ({
  nativeImage: { createFromPath: (path: string) => path },
}));
vi.mock('@main/system/logging', () => ({ log: { warn: vi.fn() } }));

const actions = { previous: vi.fn(), toggle: vi.fn(), next: vi.fn() };
const TRACK = { id: 1 } as Track;

function playerState(overrides: Partial<PlayerState>): PlayerState {
  return { status: 'idle', current: null, queueLength: 0, ...overrides } as PlayerState;
}

const PLAYING = playerState({ status: 'playing', current: TRACK, queueLength: 2 });

function fakeWindow() {
  const set = vi.fn<(buttons: ThumbarButton[]) => boolean>(() => true);
  return { win: { isDestroyed: () => false, setThumbarButtons: set } as unknown as BrowserWindow, set };
}

let thumbar: ReturnType<typeof createThumbar>;

beforeEach(() => {
  thumbar = createThumbar('icons', actions);
});

describe('the thumbnail buttons', () => {
  it('waits for a window, and says what the player is doing once there is one', () => {
    const { win, set } = fakeWindow();
    thumbar.update(PLAYING);
    expect(set).not.toHaveBeenCalled();

    thumbar.showOn(win);
    const buttons = set.mock.lastCall?.[0];
    expect(buttons?.map(({ tooltip }) => tooltip)).toEqual(['Previous', 'Pause', 'Next']);
    expect(buttons?.[1]?.icon).toEqual(expect.stringContaining('pause.png'));
    expect(buttons?.every(({ flags }) => flags?.includes('enabled'))).toBe(true);
  });

  it('offers Play when paused, and turns off what can not be used', () => {
    const { win, set } = fakeWindow();
    thumbar.showOn(win);

    thumbar.update(playerState({ status: 'paused', current: TRACK, queueLength: 1 }));
    expect(set.mock.lastCall?.[0][1]?.tooltip).toBe('Play');

    thumbar.update(playerState({ status: 'idle' }));
    expect(set.mock.lastCall?.[0].map(({ flags }) => flags?.[0])).toEqual(['disabled', 'disabled', 'disabled']);
  });

  it('only touches the taskbar when something it shows has changed', () => {
    const { win, set } = fakeWindow();
    thumbar.showOn(win);
    thumbar.update(PLAYING);
    thumbar.update({ ...PLAYING, volume: 20 });
    expect(set).toHaveBeenCalledTimes(1);
  });

  it('puts them back on a window shown again, which lost them when it was hidden', () => {
    const main = fakeWindow();
    const mini = fakeWindow();
    thumbar.update(PLAYING);
    thumbar.showOn(main.win);
    thumbar.showOn(mini.win);
    thumbar.showOn(main.win);
    expect(mini.set).toHaveBeenCalledTimes(1);
    expect(main.set).toHaveBeenCalledTimes(2);
  });

  it('tries again next time when Windows refuses', () => {
    const { win, set } = fakeWindow();
    set.mockReturnValueOnce(false);
    thumbar.update(PLAYING);
    thumbar.showOn(win);
    thumbar.update(PLAYING);
    expect(set).toHaveBeenCalledTimes(2);
  });

  it('sends a click to the player', () => {
    const { win, set } = fakeWindow();
    thumbar.update(PLAYING);
    thumbar.showOn(win);
    set.mock.lastCall?.[0][2]?.click();
    expect(actions.next).toHaveBeenCalledOnce();
  });
});
