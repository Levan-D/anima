import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PlaylistDetail, PlaylistItem, PlaylistSummary } from '@shared/domain';
import { NewPlaylistDialog } from '@/components/music/NewPlaylistDialog';
import { placeInPlaylist } from '@/features/Playlists/utils/playlistOrder';
import { Playlists } from '@/features/Playlists/Playlists';
import { setListMetrics } from '@/lib/listMetrics';
import { currentPlace, openPlaylist, selectTab, useNavigation } from '@/lib/navigation';
import { closeNewPlaylistPrompt } from '@/lib/playlistActions';
import { queryClient } from '@/lib/queryClient';
import { READY, resetRendererState, stubApi, stubLayout, track, type StubbedApi } from '@/lib/testing';

const summary = (overrides: Partial<PlaylistSummary> = {}): PlaylistSummary => ({
  id: 7,
  name: 'Road trip',
  trackCount: 0,
  missingCount: 0,
  durationMs: 0,
  artHash: null,
  updatedAt: 1,
  ...overrides,
});

const item = (itemId: number, title: string, isMissing = false, id = itemId): PlaylistItem => ({
  itemId,
  track: track({ id, title, isMissing, durationMs: 60_000 }),
});

// As main sends them: in stored order, with the missing one between the others, and one track twice.
const ITEMS = [item(1, 'One'), item(2, 'Gone', true), item(3, 'Three'), item(4, 'One again', false, 1)];

const DETAIL: PlaylistDetail = {
  ...summary({ trackCount: 4, missingCount: 1, durationMs: 180_000 }),
  items: ITEMS,
};

function mount() {
  return render(
    <QueryClientProvider client={queryClient}>
      <Playlists />
      <NewPlaylistDialog />
    </QueryClientProvider>,
  );
}

let api: StubbedApi;

function stub(overrides: Parameters<typeof stubApi>[0] = {}) {
  api = stubApi({
    'library.status': READY,
    'playlist.list': [summary({ trackCount: 4 })],
    'playlist.get': DETAIL,
    'player.play': undefined as never,
    'playlist.moveItems': undefined as never,
    'playlist.removeMissing': { removed: 1 },
    'playlist.delete': undefined as never,
    ...overrides,
  });
}

function openDetail() {
  act(() => {
    selectTab('playlists');
    openPlaylist(7);
  });
  mount();
}

beforeEach(() => {
  resetRendererState();
  closeNewPlaylistPrompt();
  stubLayout({ width: 480, height: 800 });
  setListMetrics({ row: 48, label: 42, card: 168, gap: 12, cardText: 44, gutter: 18 });
  stub();
});

describe('the list of playlists', () => {
  it('shows its four states: nothing yet, with a next step', async () => {
    stub({ 'playlist.list': [] });
    mount();
    expect(await screen.findByText('No playlists yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New playlist' }));
    expect(await screen.findByRole('dialog', { name: 'New playlist' })).toBeTruthy();
  });

  it('a read that fails can be tried again', async () => {
    stub({ 'playlist.list': { failure: 'unexpected', message: 'Nope' } });
    mount();
    expect(await screen.findByText('Nope')).toBeTruthy();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });

  it('opens a playlist through the navigation', async () => {
    mount();
    fireEvent.click(await screen.findByTestId('list-row'));
    const { result } = renderHook(() => useNavigation(currentPlace));
    expect(result.current).toEqual({ kind: 'playlist', playlistId: 7 });
  });

  it('a name that is taken keeps the dialog open and says so', async () => {
    stub({ 'playlist.list': [], 'playlist.create': { failure: 'name_taken', message: 'Already one of those' } });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'New playlist' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Mix' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(await within(dialog).findByRole('alert')).toHaveProperty('textContent', 'Already one of those');
  });
});

describe('a playlist', () => {
  it('that has gone says so, with a way back', async () => {
    stub({ 'playlist.get': { failure: 'not_found', message: 'Gone' } });
    openDetail();
    expect(await screen.findByText('This playlist has gone')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();
  });

  it('with nothing in it offers somewhere to find tracks, and still has its actions', async () => {
    stub({ 'playlist.get': { ...summary(), items: [] } });
    openDetail();
    expect(await screen.findByText('Nothing in here yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Playlist actions' })).toBeTruthy();
  });

  it('lists what can play first, and what cannot under its own heading', async () => {
    openDetail();
    await screen.findByText('Not on this device', { selector: 'h2' });
    const rows = screen.getAllByTestId('list-row').map((row) => row.textContent);
    expect(rows[0]).toContain('One');
    expect(rows[1]).toContain('Three');
    expect(rows[2]).toContain('One again');
    expect(rows[3]).toContain('Gone');
    expect(screen.getAllByTestId('list-row')[3]?.getAttribute('aria-disabled')).toBe('true');
  });

  it('playing a row queues the playable ones from that row, whichever copy of a track it is', async () => {
    openDetail();
    const row = (await screen.findByText('One again')).closest('button') as HTMLElement;
    fireEvent.click(row, { detail: 1 });
    await waitFor(() => expect(api.invoke).toHaveBeenCalledWith('player.play', { trackIds: [1, 3, 1], startIndex: 2 }));
  });

  it('Move down goes past a missing row in the stored order', async () => {
    openDetail();
    fireEvent.contextMenu(await screen.findByText('One'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move down' }));
    await waitFor(() =>
      expect(api.invoke).toHaveBeenCalledWith('playlist.moveItems', { playlistId: 7, itemIds: [1], toIndex: 2 }),
    );
  });

  it('a missing row offers Reveal, and no way to play or move it', async () => {
    openDetail();
    fireEvent.contextMenu(await screen.findByText('Gone'));
    await screen.findByRole('menuitem', { name: 'Reveal in File Explorer' });
    expect(screen.queryByRole('menuitem', { name: 'Play' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Move up' })).toBeNull();
  });

  it('Remove missing warns, and does nothing until told to', async () => {
    openDetail();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove missing' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('1 track');
    expect(api.invoke).not.toHaveBeenCalledWith('playlist.removeMissing', { playlistId: 7 });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove them' }));
    await waitFor(() => expect(api.invoke).toHaveBeenCalledWith('playlist.removeMissing', { playlistId: 7 }));
  });
});

describe('placeInPlaylist', () => {
  const STORED = [item(1, 'a'), item(2, 'gone', true), item(3, 'b'), item(4, 'c'), item(5, 'gone too', true)];

  it.each([
    ['up to the top', [4], 0, 0],
    ['down past the missing one, landing above the next playable', [1], 1, 2],
    ['to the end of the playable ones, before what is missing after them', [1], 2, 3],
    ['up by one', [4], 1, 2],
  ])('%s', (_name, moving, toIndex, stored) => {
    expect(placeInPlaylist(STORED, moving, toIndex)).toBe(stored);
  });

  it('nothing playable left to land by goes to the top', () => {
    expect(placeInPlaylist([item(1, 'a'), item(2, 'gone', true)], [1], 0)).toBe(0);
  });
});
