import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { Tooltip as RadixTooltip } from 'radix-ui';
import { beforeEach, describe, expect, it } from 'vitest';
import type { QueueItem } from '@shared/domain';
import { QueueSheet } from '@/features/Queue/QueueSheet';
import { setListMetrics } from '@/lib/listMetrics';
import { recallList } from '@/lib/listMemory';
import { currentPlace, useNavigation } from '@/lib/navigation';
import { setPlayerState } from '@/lib/playerStore';
import { queryClient } from '@/lib/queryClient';
import { setQueueSheetOpen, useQueueSheet } from '@/lib/queueSheet';
import { playerStateWith, resetRendererState, stubApi, stubLayout, track, type StubbedApi } from '@/lib/testing';

const item = (queueId: number, title: string): QueueItem => ({
  queueId,
  track: track({ id: queueId, title, durationMs: 60_000 }),
});

const THREE = [item(11, 'One'), item(12, 'Two'), item(13, 'Three')];

const COMMANDS = {
  'player.playQueueIndex': undefined as never,
  'player.removeFromQueue': undefined as never,
  'player.moveInQueue': undefined as never,
  'player.clearQueue': undefined as never,
};

function mount() {
  setQueueSheetOpen(true);
  return render(
    <QueryClientProvider client={queryClient}>
      <RadixTooltip.Provider>
        <QueueSheet />
      </RadixTooltip.Provider>
    </QueryClientProvider>,
  );
}

const rowOf = (title: string) => screen.getByText(title).closest('button') as HTMLElement;

async function openMenu(title: string) {
  fireEvent.contextMenu(await screen.findByText(title));
  await screen.findByRole('menu');
}

let api: StubbedApi;

beforeEach(() => {
  resetRendererState();
  stubLayout({ width: 480, height: 800 });
  setListMetrics({ row: 48, label: 42, card: 168, gap: 12, cardText: 44, gutter: 18, listFade: 22, islandClear: 250 });
  api = stubApi({ ...COMMANDS, 'player.queue': THREE });
  setPlayerState(playerStateWith({ status: 'playing', queueIndex: 1, queueLength: 3, queueVersion: 1 }));
});

describe('Queue', () => {
  describe('the four states', () => {
    it('shows nothing much while it asks', () => {
      const { container } = mount();
      expect(container.querySelector('.animate-appear-late')).toBeTruthy();
    });

    it('an empty queue is calm, with a next step', async () => {
      api = stubApi({ ...COMMANDS, 'player.queue': [] });
      mount();

      expect(await screen.findByText('Nothing queued')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Browse albums' }));

      expect(renderHook(() => useNavigation(currentPlace)).result.current).toEqual({ kind: 'tab', tab: 'albums' });
    });

    it('a failure has a way to try again, which works', async () => {
      let attempts = 0;
      api = stubApi({
        ...COMMANDS,
        'player.queue': () => {
          attempts++;
          return attempts === 1 ? { failure: 'unexpected', message: 'The queue broke' } : THREE;
        },
      });
      mount();

      expect((await screen.findByRole('alert')).textContent).toContain('The queue broke');
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByText('Two')).toBeTruthy();
    });

    it('has the rows once they arrive, and says how much there is', async () => {
      mount();
      expect(await screen.findByText('One')).toBeTruthy();
      expect(screen.getByText('Three')).toBeTruthy();
      expect(screen.getByText('3 tracks · 3 min')).toBeTruthy();
    });
  });

  it('marks the current place, even with the same track there twice', async () => {
    const song = track({ id: 5, title: 'Twice' });
    api = stubApi({
      ...COMMANDS,
      'player.queue': [
        { queueId: 21, track: song },
        { queueId: 22, track: song },
      ],
    });
    setPlayerState(playerStateWith({ status: 'playing', current: song, queueIndex: 1, queueVersion: 2 }));
    mount();

    const [first, second] = await screen.findAllByTestId('list-row');
    expect(first?.getAttribute('aria-current')).toBeNull();
    expect(second?.getAttribute('aria-current')).toBe('true');
  });

  it('asks main again when the queue moves on to a new version, and keeps showing the old until then', async () => {
    mount();
    await screen.findByText('One');
    api = stubApi({ ...COMMANDS, 'player.queue': [item(14, 'Four')] });

    act(() => setPlayerState(playerStateWith({ status: 'playing', queueIndex: 0, queueVersion: 2 })));

    expect(screen.getByText('One')).toBeTruthy();
    expect(await screen.findByText('Four')).toBeTruthy();
    expect(screen.queryByText('One')).toBeNull();
    expect(api.invoke).toHaveBeenCalledWith('player.queue');
  });

  it('does not ask again for a state with the same version', async () => {
    mount();
    await screen.findByText('One');
    api.invoke.mockClear();

    act(() => setPlayerState(playerStateWith({ status: 'paused', queueIndex: 1, queueVersion: 1 })));
    await act(() => Promise.resolve());

    expect(api.invoke).not.toHaveBeenCalled();
  });

  it('an old version does not hang around in memory', async () => {
    mount();
    await screen.findByText('One');
    api = stubApi({ ...COMMANDS, 'player.queue': THREE });

    act(() => setPlayerState(playerStateWith({ status: 'playing', queueVersion: 2 })));

    await waitFor(() => expect(queryClient.getQueryData(['queue', 2])).toBeTruthy());
    await waitFor(() => expect(queryClient.getQueryData(['queue', 1])).toBeUndefined());
  });

  it('opens where the current track is, wherever it was left', async () => {
    const many = Array.from({ length: 200 }, (_, index) => item(index + 1, `Track ${index + 1}`));
    api = stubApi({ ...COMMANDS, 'player.queue': many });
    setPlayerState(playerStateWith({ status: 'playing', queueIndex: 100, queueVersion: 3 }));
    mount();

    expect(await screen.findByText('Track 101')).toBeTruthy();
    expect(screen.queryByText('Track 1')).toBeNull();
    expect(recallList('queue').top).toBe(98 * 48);
  });

  describe('playing and changing it', () => {
    it('plays a row by its place', async () => {
      mount();
      fireEvent.click(await screen.findByText('Three'));
      expect(api.invoke).toHaveBeenCalledWith('player.playQueueIndex', { index: 2 });
    });

    it('a missing row can not be started', async () => {
      api = stubApi({
        ...COMMANDS,
        'player.queue': [{ queueId: 31, track: track({ title: 'Gone', isMissing: true }) }],
      });
      mount();
      await screen.findByText('Gone');

      fireEvent.click(rowOf('Gone'));

      expect(api.invoke).not.toHaveBeenCalledWith('player.playQueueIndex', expect.anything());
      expect(rowOf('Gone').textContent).toContain('Not on this device');
    });

    it('the menu plays, moves and removes, going by what the row is', async () => {
      mount();

      await openMenu('Two');
      fireEvent.click(screen.getByRole('menuitem', { name: 'Play' }));
      expect(api.invoke).toHaveBeenCalledWith('player.playQueueIndex', { index: 1 });

      await openMenu('Two');
      fireEvent.click(screen.getByRole('menuitem', { name: 'Move up' }));
      expect(api.invoke).toHaveBeenCalledWith('player.moveInQueue', { queueIds: [12], toIndex: 0 });

      await openMenu('Two');
      fireEvent.click(screen.getByRole('menuitem', { name: 'Move down' }));
      expect(api.invoke).toHaveBeenCalledWith('player.moveInQueue', { queueIds: [12], toIndex: 2 });

      await openMenu('Two');
      fireEvent.click(screen.getByRole('menuitem', { name: 'Remove from queue' }));
      expect(api.invoke).toHaveBeenCalledWith('player.removeFromQueue', { queueIds: [12] });
    });

    it('the first row can not go up, and the last can not go down', async () => {
      mount();

      await openMenu('One');
      expect(screen.getByRole('menuitem', { name: 'Move up' }).getAttribute('aria-disabled')).toBe('true');
      expect(screen.getByRole('menuitem', { name: 'Move down' }).getAttribute('aria-disabled')).toBeNull();
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

      await openMenu('Three');
      expect(screen.getByRole('menuitem', { name: 'Move up' }).getAttribute('aria-disabled')).toBeNull();
      expect(screen.getByRole('menuitem', { name: 'Move down' }).getAttribute('aria-disabled')).toBe('true');
    });

    it('Clear clears', async () => {
      mount();
      fireEvent.click(await screen.findByRole('button', { name: 'Clear queue' }));
      expect(api.invoke).toHaveBeenCalledWith('player.clearQueue');
    });
  });

  describe('the sheet', () => {
    const isOpen = () => renderHook(() => useQueueSheet()).result.current;

    it('Endless is a toggle that says which way it is', async () => {
      mount();
      const endless = await screen.findByRole('button', { name: /^Endless/ });
      expect(endless.getAttribute('aria-pressed')).toBe('false');
    });

    it('offers the way back to a saved queue while radio has the queue', async () => {
      setPlayerState(
        playerStateWith({
          status: 'playing',
          queueIndex: 0,
          queueVersion: 4,
          radio: { ...playerStateWith({}).radio, isSource: true, hasSavedQueue: true },
        }),
      );
      mount();
      expect(await screen.findByRole('button', { name: 'Your saved queue' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: /^Endless/ })).toBeNull();
    });

    it('closes from its X, its handle and Escape', async () => {
      mount();
      fireEvent.click(await screen.findByRole('button', { name: 'Close queue' }));
      expect(isOpen()).toBe(false);

      act(() => setQueueSheetOpen(true));
      fireEvent.click(await screen.findByTestId('sheet-handle'));
      expect(isOpen()).toBe(false);

      act(() => setQueueSheetOpen(true));
      await screen.findByTestId('sheet-handle');
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(isOpen()).toBe(false);
    });
  });
});
