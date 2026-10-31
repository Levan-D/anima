import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { Tooltip } from 'radix-ui';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PlayerState } from '@shared/domain';
import { Transport } from '@/features/Transport/Transport';
import { currentPlace, useNavigation } from '@/lib/navigation';
import { setPlayerState } from '@/lib/playerStore';
import { playerStateWith, resetRendererState, stubApi, track, type StubbedApi } from '@/lib/testing';
import { useToasts } from '@/lib/toastStore';

const CD = { sampleRate: 44_100, format: 's16', channels: 2 };

const playing = (overrides: Partial<PlayerState> = {}) =>
  playerStateWith({
    status: 'playing',
    current: track({ title: 'Jóga', artist: 'Björk', album: 'Homogenic' }),
    queueIndex: 0,
    queueLength: 3,
    durationMs: 200_000,
    ...overrides,
  });

function mount(state: PlayerState = playing()) {
  setPlayerState(state);
  return render(
    <Tooltip.Provider>
      <Transport />
    </Tooltip.Provider>,
  );
}

const navigationState = () => renderHook(() => useNavigation((state) => state)).result.current;
const isDisabled = (name: string) => screen.getByRole<HTMLButtonElement>('button', { name }).disabled;

const COMMANDS = {
  'player.toggle': undefined as never,
  'player.next': undefined as never,
  'player.previous': undefined as never,
  'player.seek': undefined as never,
  'player.setVolume': undefined as never,
  'player.setMuted': undefined as never,
  'player.setOutputMode': undefined as never,
  'player.retry': undefined as never,
};

let api: StubbedApi;

beforeEach(() => {
  resetRendererState();
  api = stubApi(COMMANDS);
});

describe('Transport', () => {
  it('has a button for the mini player, for what has no Ctrl+M', () => {
    const api = stubApi({ 'window.setMiniPlayer': undefined as never });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Mini player' }));
    expect(api.invoke).toHaveBeenCalledWith('window.setMiniPlayer', { enabled: true });
  });

  describe('what is playing', () => {
    it('shows the title, the artist and the album', () => {
      mount();
      expect(screen.getByTestId('now-playing-title').textContent).toBe('Jóga');
      expect(screen.getByTestId('now-playing-details').textContent).toBe('Björk · Homogenic');
    });

    it('makes the artist and the album links to their pages', () => {
      mount(playing({ current: track({ artist: 'Björk', artistId: 7, album: 'Homogenic', albumId: 9 }) }));

      fireEvent.click(screen.getByRole('button', { name: 'Björk' }));
      expect(currentPlace(navigationState())).toEqual({ kind: 'artist', artistId: 7 });

      fireEvent.click(screen.getByRole('button', { name: 'Homogenic' }));
      expect(currentPlace(navigationState())).toEqual({ kind: 'album', albumId: 9 });
    });

    it('leaves out an album it does not have', () => {
      mount(playing({ current: track({ artist: 'Björk', album: null }) }));
      expect(screen.getByTestId('now-playing-details').textContent).toBe('Björk');
    });

    it('with nothing playing, takes up the same room and says nothing', () => {
      mount(playerStateWith());
      expect(screen.getByTestId('now-playing-title').textContent).toBe('');
      expect(screen.getByTestId('now-playing-title').className).toContain('min-h-lh');
      expect(screen.getByTestId('elapsed').textContent).toBe('');
    });
  });

  describe('the buttons', () => {
    it.each([
      ['Previous', 'player.previous'],
      ['Pause', 'player.toggle'],
      ['Next', 'player.next'],
    ])('%s sends %s', (name, command) => {
      mount();
      fireEvent.click(screen.getByRole('button', { name }));
      expect(api.invoke).toHaveBeenCalledWith(command);
    });

    it.each([
      ['playing', 'Pause'],
      ['loading', 'Pause'],
      ['paused', 'Play'],
      ['ended', 'Play'],
      ['error', 'Play'],
    ] as const)('while %s the middle one says %s', (status, name) => {
      mount(playing({ status }));
      expect(screen.getByRole('button', { name })).toBeTruthy();
    });

    it('wait for something to play', () => {
      mount(playerStateWith());
      for (const name of ['Previous', 'Play', 'Next']) expect(isDisabled(name)).toBe(true);
    });

    it('a queue with nothing current can still start', () => {
      mount(playerStateWith({ queueLength: 2 }));
      expect(isDisabled('Play')).toBe(false);
      expect(isDisabled('Next')).toBe(true);
    });

    it('say so when main refuses', async () => {
      api = stubApi({ ...COMMANDS, 'player.next': { failure: 'engine_unavailable', message: 'No engine' } });
      mount();
      const { result } = renderHook(() => useToasts());

      fireEvent.click(screen.getByRole('button', { name: 'Next' }));

      await waitFor(() => expect(result.current.at(-1)).toMatchObject({ message: 'No engine', level: 'error' }));
    });
  });

  describe('the seekbar', () => {
    const thumb = () => screen.getByRole('slider', { name: 'Seek' });

    it('steps from where it is, by keyboard, and tells main', () => {
      mount();
      fireEvent.keyDown(thumb(), { key: 'End' });
      expect(api.invoke).toHaveBeenLastCalledWith('player.seek', { positionMs: 200_000 });
    });

    it('moves on screen before main has answered', () => {
      mount();
      fireEvent.keyDown(thumb(), { key: 'End' });
      expect(screen.getByTestId('elapsed').textContent).toBe('3:20 / 3:20');
      expect(screen.queryByTestId('remaining')).toBeNull();
    });

    it('can not be used with nothing playing', () => {
      mount(playerStateWith());
      expect(thumb().getAttribute('tabindex')).toBeNull();
    });

    it('leaves a key that is not for it alone', () => {
      mount();
      fireEvent.keyDown(thumb(), { key: 'a' });
      expect(api.invoke).not.toHaveBeenCalledWith('player.seek', expect.anything());
    });
  });

  describe('the volume', () => {
    const slider = () => screen.getByRole('slider', { name: 'Volume' });

    it('shows what main has, and sends a change', () => {
      mount(playing({ volume: 40 }));
      expect(slider().getAttribute('aria-valuenow')).toBe('40');

      fireEvent.keyDown(slider(), { key: 'ArrowRight' });

      expect(api.invoke).toHaveBeenCalledWith('player.setVolume', { volume: 41 });
    });

    it('a second step starts from the first, before main has answered', () => {
      mount(playing({ volume: 40 }));
      fireEvent.keyDown(slider(), { key: 'ArrowRight' });
      fireEvent.keyDown(slider(), { key: 'ArrowRight' });
      expect(api.invoke).toHaveBeenLastCalledWith('player.setVolume', { volume: 42 });
    });

    it('goes back to following main once main has answered', async () => {
      mount(playing({ volume: 40 }));
      fireEvent.keyDown(slider(), { key: 'ArrowRight' });
      await waitFor(() => expect(slider().getAttribute('aria-valuenow')).toBe('40'));

      act(() => setPlayerState(playing({ volume: 70 })));

      expect(slider().getAttribute('aria-valuenow')).toBe('70');
    });

    it('mute toggles, and says which way it would go', () => {
      mount(playing({ muted: true }));
      const button = screen.getByRole('button', { name: 'Unmute' });
      expect(button.getAttribute('aria-pressed')).toBe('true');

      fireEvent.click(button);

      expect(api.invoke).toHaveBeenCalledWith('player.setMuted', { muted: false });
    });

    it('reaching for the volume while muted means wanting to hear it', () => {
      mount(playing({ muted: true, volume: 40 }));
      fireEvent.keyDown(slider(), { key: 'ArrowRight' });
      expect(api.invoke).toHaveBeenCalledWith('player.setMuted', { muted: false });
    });
  });

  describe('the signal', () => {
    const SIGNAL = { decoded: CD, output: CD };

    it('says what it is, and the rest is a press away', async () => {
      mount(playing({ signal: { ...SIGNAL, isBitPerfect: false, alterations: ['Windows is mixing', 'Muted'] } }));
      const [status] = screen.getAllByTestId('signal-status');
      expect(status?.textContent).toContain('44.1 kHz · 16-bit · Windows is mixing');

      fireEvent.click(status as Element);

      const details = await screen.findByTestId('signal-details');
      expect(details.textContent).toContain('44.1 kHz · 16-bit · stereo');
      expect(details.textContent).toContain('Windows is mixing');
      expect(details.textContent).toContain('Muted');
    });

    it('says plainly when nothing is changing it', async () => {
      mount(playing({ signal: { ...SIGNAL, isBitPerfect: true, alterations: [] } }));
      const [status] = screen.getAllByTestId('signal-status');
      expect(status?.textContent).toContain('Bit-perfect');

      fireEvent.click(status as Element);

      expect((await screen.findByTestId('signal-details')).textContent).toContain('nothing is changing the signal');
    });

    it('has nothing to show with nothing playing', () => {
      mount(playerStateWith());
      expect(screen.queryByTestId('signal-status')).toBeNull();
    });
  });

  describe('the exclusive switch', () => {
    const switches = () => screen.getAllByRole('switch');

    it('says what it does, since it cuts off other apps', () => {
      mount();
      expect(switches()[0]?.closest('label')?.textContent).toContain('mutes other apps');
    });

    it('asks main, and shows what main says', () => {
      mount();
      fireEvent.click(switches()[0] as Element);
      expect(api.invoke).toHaveBeenCalledWith('player.setOutputMode', { mode: 'exclusive' });
      expect(switches()[0]?.getAttribute('aria-checked')).toBe('false');

      act(() => setPlayerState(playing({ outputMode: 'exclusive' })));
      expect(switches()[0]?.getAttribute('aria-checked')).toBe('true');

      fireEvent.click(switches()[0] as Element);
      expect(api.invoke).toHaveBeenCalledWith('player.setOutputMode', { mode: 'shared' });
    });
  });

  describe('when something is wrong', () => {
    it.each(['error', 'unavailable'] as const)(
      '%s says what happened where the title was, and offers Retry',
      (status) => {
        mount(playing({ status, error: { code: 'device_busy', message: "The audio device couldn't be opened." } }));
        const alert = screen.getByRole('alert');

        expect(alert.textContent).toContain("The audio device couldn't be opened.");
        expect(screen.queryByTestId('now-playing-title')).toBeNull();

        fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));

        expect(api.invoke).toHaveBeenCalledWith('player.retry');
      },
    );

    it('with no engine at all, the rest of the controls wait', () => {
      mount(playing({ status: 'unavailable', error: { code: 'engine_unavailable', message: 'No engine.' } }));
      for (const name of ['Previous', 'Next']) expect(isDisabled(name)).toBe(true);
      expect(screen.getByRole('slider', { name: 'Seek' }).getAttribute('tabindex')).toBeNull();
    });

    it('a device error keeps the song within reach', () => {
      mount(playing({ status: 'error', error: { code: 'device_busy', message: 'No device.' } }));
      expect(isDisabled('Next')).toBe(false);
    });

    it('while loading, nothing makes a fuss', () => {
      mount(playing({ status: 'loading' }));
      expect(screen.queryByRole('alert')).toBeNull();
      expect(document.querySelector('.animate-spin')).toBeNull();
    });
  });
});
