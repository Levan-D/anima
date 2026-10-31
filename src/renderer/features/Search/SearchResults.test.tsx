import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchField } from '@/features/Search/SearchField';
import { SearchResults } from '@/features/Search/SearchResults';
import { setListMetrics } from '@/lib/listMetrics';
import { currentPlace, isSearching, setSearchQuery, useNavigation } from '@/lib/navigation';
import { queryClient } from '@/lib/queryClient';
import {
  album,
  artist,
  IDLE_SCAN,
  NOTHING_FOUND,
  resetRendererState,
  stubApi,
  stubLayout,
  track,
  type StubbedApi,
} from '@/lib/testing';

function mount() {
  return render(
    <QueryClientProvider client={queryClient}>
      <SearchField />
      <SearchResults />
    </QueryClientProvider>,
  );
}

function navigation() {
  return renderHook(() => useNavigation((state) => state)).result.current;
}

const FOUND = {
  ...NOTHING_FOUND,
  artists: [artist({ id: 3, name: 'Nightwish' })],
  albums: [album({ id: 4, title: 'Night Visions', artist: 'Imagine Dragons' })],
  tracks: [
    track({ id: 5, title: 'Nightcall', albumId: 6 }),
    track({ id: 7, title: 'Loose', albumId: null, artistId: 8 }),
  ],
};

let api: StubbedApi;

beforeEach(() => {
  resetRendererState();
  stubLayout({ width: 480, height: 800 });
  setListMetrics({ row: 48, label: 42, card: 168, gap: 12, cardText: 44, gutter: 18 });
  api = stubApi({ 'library.search': FOUND, 'player.play': undefined as never });
  act(() => setSearchQuery('night'));
});

describe('SearchResults', () => {
  it('has a labelled section for each kind of result', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: 'Artists' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Albums' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Tracks' })).toBeTruthy();
    expect(screen.getByText('Nightwish')).toBeTruthy();
    expect(screen.getByText('Night Visions')).toBeTruthy();
    expect(screen.getByText('Nightcall')).toBeTruthy();
  });

  it('leaves out a section with nothing in it', async () => {
    stubApi({ 'library.search': { ...FOUND, artists: [], tracks: [] } });
    mount();
    expect(await screen.findByRole('heading', { name: 'Albums' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Artists' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Tracks' })).toBeNull();
  });

  it('nothing found is friendly, and offers the way out', async () => {
    stubApi({ 'library.search': NOTHING_FOUND });
    mount();

    expect(await screen.findByText('Nothing matches “night”')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear search' })[1] as Element);
    expect(isSearching(navigation())).toBe(false);
  });

  it('while a scan is still reading, nothing found is not a spelling problem', async () => {
    stubApi({ 'library.search': NOTHING_FOUND, 'scan.state': { ...IDLE_SCAN, phase: 'reading' } });
    mount();

    expect(await screen.findByText('Still reading your music')).toBeTruthy();
    expect(screen.getByText('Nothing yet for “night”')).toBeTruthy();
    expect(screen.queryByText(/spelling/)).toBeNull();
  });

  it('says when a list was cut off, and not when it was not', async () => {
    stubApi({
      'library.search': { ...FOUND, more: { artists: false, albums: true, tracks: true } },
    });
    mount();

    expect(await screen.findByRole('heading', { name: 'Artists' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'First 1 albums' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'First 2 tracks' })).toBeTruthy();
  });

  it('a new search keeps the rows that are in both, and goes back to the top', async () => {
    const replies: Record<string, typeof FOUND> = {
      night: FOUND,
      nightw: { ...FOUND, artists: [], albums: [] },
    };
    vi.stubGlobal('api', {
      invoke: (_name: string, input: { query: string }) =>
        Promise.resolve({ ok: true, value: replies[input.query] ?? NOTHING_FOUND }),
      on: () => () => {},
    });
    mount();
    const row = (await screen.findByText('Nightcall')).closest('button');
    const scroller = screen.getByTestId('list-scroller');
    scroller.scrollTop = 300;

    act(() => setSearchQuery('nightw'));
    await waitFor(() => expect(screen.queryByText('Nightwish')).toBeNull());

    expect(screen.getByText('Nightcall').closest('button')).toBe(row);
    expect(scroller.scrollTop).toBe(0);
  });

  it('a failure has a way to try again', async () => {
    stubApi({ 'library.search': { failure: 'unexpected', message: 'Something broke' } });
    mount();
    expect((await screen.findByRole('alert')).textContent).toContain('Something broke');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('an artist or album result drills in', async () => {
    mount();
    fireEvent.click(await screen.findByText('Nightwish'));
    expect(currentPlace(navigation())).toEqual({ kind: 'artist', artistId: 3 });
    expect(navigation().query).toBe('');
  });

  it('an album result drills into the album', async () => {
    mount();
    fireEvent.click(await screen.findByText('Night Visions'));
    expect(currentPlace(navigation())).toEqual({ kind: 'album', albumId: 4 });
  });

  it('a track result plays, with the tracks found as the queue, and stays where it is', async () => {
    mount();
    fireEvent.click(await screen.findByText('Loose'));
    await waitFor(() => expect(api.invoke).toHaveBeenCalledWith('player.play', { trackIds: [5, 7], startIndex: 1 }));
    expect(currentPlace(navigation())).toEqual({ kind: 'tab', tab: 'albums' });
    expect(navigation().query).toBe('night');
  });

  it('the menu on a track result goes to its album, or its artist when it has none', async () => {
    const { unmount } = mount();
    fireEvent.contextMenu(await screen.findByText('Nightcall'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Go to album' }));
    expect(currentPlace(navigation())).toEqual({ kind: 'album', albumId: 6 });
    unmount();

    act(() => setSearchQuery('loose'));
    mount();
    fireEvent.contextMenu(await screen.findByText('Loose'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Go to artist' }));
    expect(currentPlace(navigation())).toEqual({ kind: 'artist', artistId: 8 });
  });

  it('sends what was typed, trimmed', async () => {
    act(() => setSearchQuery('  night  '));
    mount();
    await screen.findByText('Nightwish');
    expect(api.invoke).toHaveBeenCalledWith('library.search', { query: 'night' });
  });
});

describe('going between the field and the results by keyboard', () => {
  function mountInPanel() {
    return render(
      <QueryClientProvider client={queryClient}>
        <SearchField />
        <div role="tabpanel">
          <SearchResults />
        </div>
      </QueryClientProvider>,
    );
  }

  it.each(['ArrowDown', 'Enter'])('%s in the field goes to the first result', async (key) => {
    mountInPanel();
    await screen.findByText('Nightwish');
    const field = screen.getByRole('searchbox');
    act(() => field.focus());

    fireEvent.keyDown(field, { key });

    expect(document.activeElement).toBe(screen.getByText('Nightwish').closest('button'));
  });

  it('Arrow Up on the first result comes back to the field', async () => {
    mountInPanel();
    await screen.findByText('Nightwish');
    const field = screen.getByRole('searchbox');
    act(() => field.focus());
    fireEvent.keyDown(field, { key: 'ArrowDown' });

    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowUp' });

    expect(document.activeElement).toBe(field);
  });

  it('is left alone when there is no list to go to', () => {
    act(() => setSearchQuery(''));
    render(
      <QueryClientProvider client={queryClient}>
        <SearchField />
      </QueryClientProvider>,
    );
    const field = screen.getByRole('searchbox');
    act(() => field.focus());
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(field);
  });
});

describe('SearchField', () => {
  it('typing is searching, and the clear control ends it and keeps focus in the field', () => {
    act(() => setSearchQuery(''));
    render(
      <QueryClientProvider client={queryClient}>
        <SearchField />
      </QueryClientProvider>,
    );
    const field = screen.getByRole('searchbox');
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();

    fireEvent.change(field, { target: { value: 'night' } });
    expect(navigation().query).toBe('night');

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(navigation().query).toBe('');
    expect(document.activeElement).toBe(field);
  });

  it('stops at the longest query main accepts', () => {
    act(() => setSearchQuery(''));
    render(
      <QueryClientProvider client={queryClient}>
        <SearchField />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('searchbox').getAttribute('maxlength')).toBe('200');
  });
});
