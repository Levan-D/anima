import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ScanState } from '@shared/domain';
import { Library } from '@/features/Library/Library';
import { setListMetrics } from '@/lib/listMetrics';
import { currentPlace, openAlbum, openArtist, openGenre, selectTab, useNavigation } from '@/lib/navigation';
import { queryClient } from '@/lib/queryClient';
import {
  album,
  artist,
  genre,
  IDLE_SCAN,
  READY,
  resetRendererState,
  scanReport,
  stubApi,
  stubLayout,
  track,
  type StubbedApi,
} from '@/lib/testing';
import { useLibrarySync } from '@/lib/useLibrarySync';

function Mounted() {
  useLibrarySync();
  return <Library />;
}

function mount() {
  return render(
    <QueryClientProvider client={queryClient}>
      <Mounted />
    </QueryClientProvider>,
  );
}

const BASE = {
  'library.status': READY,
  'scan.state': IDLE_SCAN,
  'library.albums': [album()],
  'library.artists': [artist()],
  'library.genres': [genre()],
  'library.tracks': [track()],
  'library.album': album(),
  'library.artist': artist(),
};

beforeEach(() => {
  resetRendererState();
  stubLayout({ width: 480, height: 480 });
  setListMetrics({ row: 48, label: 42, card: 168, gap: 12, cardText: 44, gutter: 18 });
});

describe('Library', () => {
  describe('the four states', () => {
    it('shows a skeleton only while there is truly nothing yet', () => {
      stubApi(BASE);
      const { container } = mount();
      expect(container.querySelector('.animate-appear-late')).toBeTruthy();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('has data once it arrives', async () => {
      stubApi(BASE);
      mount();
      expect(await screen.findByText('Homogenic')).toBeTruthy();
    });

    it('shows a failure with a way to try again, which works', async () => {
      let attempts = 0;
      stubApi({
        ...BASE,
        'library.albums': () => {
          attempts++;
          return attempts === 1 ? { failure: 'db_corrupt', message: 'The library database is damaged' } : [album()];
        },
      });
      mount();

      expect((await screen.findByRole('alert')).textContent).toContain('The library database is damaged');
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByText('Homogenic')).toBeTruthy();
    });

    it('an empty list has a next step', async () => {
      stubApi({ ...BASE, 'library.albums': [], 'library.tracks': [track({ title: 'Some track' })] });
      mount();

      fireEvent.click(await screen.findByRole('button', { name: 'Browse tracks' }));

      expect(await screen.findByText('Some track')).toBeTruthy();
    });

    describe('with nothing on this device', () => {
      it.each([
        ['tracks', 'No tracks here'],
        ['artists', 'No artists here'],
      ] as const)('%s offers a rescan, and the missing list when something is on it', async (tab, title) => {
        const api = stubApi({
          ...BASE,
          'library.tracks': ({ filter }) => (filter.kind === 'missing' ? [track({ isMissing: true })] : []),
          'library.artists': [],
          'scan.start': undefined as never,
        });
        act(() => selectTab(tab));
        mount();

        expect(await screen.findByText(title)).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Browse tracks' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Rescan' }));
        await waitFor(() => expect(api.invoke).toHaveBeenCalledWith('scan.start'));

        fireEvent.click(await screen.findByRole('button', { name: "Show what's missing" }));
        expect(renderHook(() => useNavigation(currentPlace)).result.current).toEqual({ kind: 'missing' });
      });

      it('leaves out the missing list when nothing is on it', async () => {
        stubApi({ ...BASE, 'library.tracks': [] });
        act(() => selectTab('tracks'));
        mount();
        await screen.findByText('No tracks here');
        await act(() => Promise.resolve());
        expect(screen.getByRole('button', { name: 'Rescan' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: "Show what's missing" })).toBeNull();
      });
    });

    it('an empty list while a scan runs just means nothing was found yet', async () => {
      stubApi({ ...BASE, 'library.albums': [], 'scan.state': { ...IDLE_SCAN, phase: 'walking' } });
      const { container } = mount();

      await waitFor(() => expect(queryClient.getQueryData(['scan'])).toBeTruthy());
      await waitFor(() =>
        expect(queryClient.getQueryData(['library', 'albums', { artistId: null, genreId: null }])).toEqual([]),
      );
      expect(container.querySelector('.animate-appear-late')).toBeTruthy();
      expect(screen.queryByText('No albums yet')).toBeNull();
    });
  });

  describe('a folder with no music in it', () => {
    it('says so, with Rescan and Change folder, only once no scan is running', async () => {
      const api: StubbedApi = stubApi({
        ...BASE,
        'library.status': { ...READY, isEmpty: true },
        'library.albums': [],
        'scan.start': undefined as never,
        'library.chooseFolder': { ...READY, isEmpty: true },
      });
      mount();

      expect(await screen.findByText('No music found in this folder')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Change folder' }));
      await waitFor(() => expect(api.invoke).toHaveBeenCalledWith('library.chooseFolder'));
      expect(screen.getByRole('button', { name: 'Rescan' })).toBeTruthy();

      act(() => api.emit('scan.state', { ...IDLE_SCAN, phase: 'walking' }));
      await waitFor(() => expect(screen.queryByText('No music found in this folder')).toBeNull());
    });

    it('says where it looked and what for', async () => {
      stubApi({ ...BASE, 'library.status': { ...READY, isEmpty: true } });
      mount();
      expect(await screen.findByText('Looked in D:\\Music for FLAC, MP3 and other audio')).toBeTruthy();
    });

    it('does not say so while it can not tell whether a scan is running', async () => {
      let answer: (state: ScanState) => void = () => {};
      stubApi({
        ...BASE,
        'library.status': { ...READY, isEmpty: true },
        'scan.state': () =>
          new Promise((done) => {
            answer = done;
          }),
      });
      mount();
      await waitFor(() => expect(queryClient.getQueryData(['status'])).toBeTruthy());
      await act(() => Promise.resolve());
      expect(screen.queryByText('No music found in this folder')).toBeNull();

      act(() => answer(IDLE_SCAN));
      expect(await screen.findByText('No music found in this folder')).toBeTruthy();
    });

    it('does not claim there is no music when the scan was cancelled before it found any', async () => {
      stubApi({
        ...BASE,
        'library.status': { ...READY, isEmpty: true },
        'scan.state': { ...IDLE_SCAN, lastReport: scanReport({ cancelled: true }) },
      });
      mount();
      expect(await screen.findByText('The scan was cancelled before it found anything')).toBeTruthy();
      expect(screen.queryByText('No music found in this folder')).toBeNull();
    });

    it('leaves Playlists and Queue their own empty states', async () => {
      stubApi({ ...BASE, 'library.status': { ...READY, isEmpty: true } });
      mount();
      await screen.findByText('No music found in this folder');

      act(() => selectTab('playlists'));
      expect(screen.getByText('No playlists yet')).toBeTruthy();
      act(() => selectTab('queue'));
      expect(screen.getByText('Nothing queued')).toBeTruthy();
    });
  });

  describe('live updates', () => {
    it('a refresh keeps the list up, with no skeleton', async () => {
      let titles = ['Homogenic'];
      const api = stubApi({
        ...BASE,
        'library.albums': () => titles.map((title, index) => album({ id: index + 1, title })),
      });
      const { container } = mount();
      await screen.findByText('Homogenic');
      const list = screen.getByRole('list');

      titles = ['Homogenic', 'Vespertine'];
      act(() => api.emit('library.changed', { scopes: ['library'] }));
      expect(container.querySelector('.animate-appear-late')).toBeNull();

      expect(await screen.findByText('Vespertine')).toBeTruthy();
      expect(screen.getByRole('list')).toBe(list);
    });

    it('scan progress does not touch the list', async () => {
      const api = stubApi(BASE);
      mount();
      await screen.findByText('Homogenic');
      const reads = api.invoke.mock.calls.filter(([name]) => name === 'library.albums').length;
      const card = screen.getByTestId('album-card');

      for (let done = 0; done < 5; done++) {
        act(() => api.emit('scan.state', { ...IDLE_SCAN, phase: 'reading', filesFound: 10, filesDone: done }));
      }

      expect(api.invoke.mock.calls.filter(([name]) => name === 'library.albums')).toHaveLength(reads);
      expect(screen.getByTestId('album-card')).toBe(card);
    });
  });

  describe('drilling in', () => {
    it('an album has its header, with a link to its artist', async () => {
      stubApi({
        ...BASE,
        'library.album': album({ title: 'Homogenic', year: 1997, trackCount: 2, durationMs: 600_000 }),
        'library.tracks': [track({ id: 1, title: 'Jóga' }), track({ id: 2, title: 'Hunter', trackNumber: 2 })],
      });
      act(() => openAlbum(1));
      mount();

      expect(await screen.findByRole('heading', { name: 'Homogenic' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Björk' })).toBeTruthy();
      expect(screen.getByText('1997 · 2 tracks · 10 min')).toBeTruthy();
      expect(screen.getByText('Hunter')).toBeTruthy();
    });

    it('an album on several discs gets a heading for each', async () => {
      stubApi({
        ...BASE,
        'library.tracks': [track({ id: 1, discNumber: 1 }), track({ id: 2, discNumber: 2, title: 'Other' })],
      });
      act(() => openAlbum(1));
      mount();

      expect(await screen.findByRole('heading', { name: 'Disc 1' })).toBeTruthy();
      expect(screen.getByRole('heading', { name: 'Disc 2' })).toBeTruthy();
    });

    it('an artist shows albums, then tracks, and asks only for that artist', async () => {
      const api = stubApi(BASE);
      act(() => openArtist(1));
      mount();

      expect(await screen.findByRole('heading', { name: 'Björk' })).toBeTruthy();
      expect(screen.getByTestId('album-card')).toBeTruthy();
      expect(screen.getByRole('heading', { name: 'Tracks' })).toBeTruthy();
      expect(api.invoke).toHaveBeenCalledWith('library.albums', { artistId: 1, genreId: null });
      expect(api.invoke).toHaveBeenCalledWith('library.tracks', { filter: { kind: 'artist', artistId: 1 } });
    });

    it('a genre shows its albums', async () => {
      const api = stubApi(BASE);
      act(() => openGenre(1));
      mount();

      expect(await screen.findByRole('heading', { name: 'Electronic' })).toBeTruthy();
      expect(screen.getByTestId('album-card')).toBeTruthy();
      expect(api.invoke).toHaveBeenCalledWith('library.albums', { artistId: null, genreId: 1 });
    });

    it('a genre labels the tracks that follow its albums', async () => {
      stubApi({ ...BASE, 'library.tracks': [track({ id: 2, albumId: null, album: null, title: 'Loose' })] });
      act(() => openGenre(1));
      mount();

      expect(await screen.findByRole('heading', { name: 'Tracks' })).toBeTruthy();
      expect(screen.getByText('Loose')).toBeTruthy();
    });

    it('a genre has no such label with nothing to put under it', async () => {
      stubApi(BASE);
      act(() => openGenre(1));
      mount();

      await screen.findByRole('heading', { name: 'Electronic' });
      expect(screen.queryByRole('heading', { name: 'Tracks' })).toBeNull();
    });

    it('an album with nothing left says so, with the way back, and no retry that can not work', async () => {
      stubApi({ ...BASE, 'library.album': { failure: 'not_found', message: "That album isn't in the library" } });
      act(() => openAlbum(99));
      mount();

      expect(await screen.findByText('Nothing left on this album')).toBeTruthy();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();
    });

    it('an artist with nothing left says the same', async () => {
      stubApi({ ...BASE, 'library.artist': { failure: 'not_found', message: "That artist isn't in the library" } });
      act(() => openArtist(99));
      mount();

      expect(await screen.findByText('Nothing left by this artist')).toBeTruthy();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('any other failure still gets the retry', async () => {
      stubApi({ ...BASE, 'library.album': { failure: 'db_corrupt', message: 'The library database is damaged' } });
      act(() => openAlbum(1));
      mount();

      expect((await screen.findByRole('alert')).textContent).toContain('The library database is damaged');
    });

    it('asks for the full image in an album header, over the thumbnail', async () => {
      stubApi(BASE);
      act(() => openAlbum(1));
      const { container } = mount();
      await screen.findByRole('heading', { name: 'Homogenic' });
      const sources = [...container.querySelectorAll('header img')].map((image) => image.getAttribute('src'));
      expect(sources).toEqual([`art://thumb/${'a'.repeat(40)}`, `art://full/${'a'.repeat(40)}`]);
    });
  });
});
