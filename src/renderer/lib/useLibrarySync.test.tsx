import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { LibraryStatus } from '@shared/domain';
import { albumsQuery, scanQuery, settingsQuery, statusQuery } from '@/lib/libraryQueries';
import { currentPlace, openAlbum, useNavigation } from '@/lib/navigation';
import { queryClient } from '@/lib/queryClient';
import { album, IDLE_SCAN, READY, resetRendererState, stubApi, type StubbedApi } from '@/lib/testing';
import { useLibrarySync } from '@/lib/useLibrarySync';

const EVERY_ALBUM = { artistId: null, genreId: null };

function Probe({ children }: { children?: ReactNode }) {
  useLibrarySync();
  const status = useQuery(statusQuery);
  const scan = useQuery(scanQuery);
  const settings = useQuery(settingsQuery);
  const albums = useQuery(albumsQuery(EVERY_ALBUM));
  const place = useNavigation(currentPlace);

  return (
    <>
      <p data-testid="status">{status.data?.state}</p>
      <p data-testid="scan">{scan.data?.phase}</p>
      <p data-testid="size">{settings.data?.uiScale}</p>
      <p data-testid="albums">{albums.data?.map(({ title }) => title).join()}</p>
      <p data-testid="place">{place.kind}</p>
      {children}
    </>
  );
}

function mount() {
  return render(
    <QueryClientProvider client={queryClient}>
      <Probe />
    </QueryClientProvider>,
  );
}

let api: StubbedApi;
let albumTitles: string[];

beforeEach(() => {
  resetRendererState();
  albumTitles = ['Homogenic'];
  api = stubApi({
    'library.status': READY,
    'scan.state': IDLE_SCAN,
    'settings.get': { uiScale: 1 } as never,
    'library.albums': () => albumTitles.map((title, index) => album({ id: index + 1, title })),
  });
});

const text = (id: string) => screen.getByTestId(id).textContent;

describe('useLibrarySync', () => {
  it('reads nothing again until main says something changed', async () => {
    mount();
    await waitFor(() => expect(text('albums')).toBe('Homogenic'));
    const reads = api.invoke.mock.calls.filter(([name]) => name === 'library.albums').length;

    albumTitles = ['Homogenic', 'Vespertine'];
    act(() => api.emit('library.changed', { scopes: ['playlists'] }));
    await act(() => new Promise((done) => setTimeout(done, 20)));
    expect(api.invoke.mock.calls.filter(([name]) => name === 'library.albums')).toHaveLength(reads);

    act(() => api.emit('library.changed', { scopes: ['library'] }));
    await waitFor(() => expect(text('albums')).toBe('Homogenic,Vespertine'));
  });

  it('takes scan state and settings straight from their events', async () => {
    mount();
    await waitFor(() => expect(text('scan')).toBe('idle'));

    act(() => api.emit('scan.state', { ...IDLE_SCAN, phase: 'reading', filesFound: 5, filesDone: 1 }));
    await waitFor(() => expect(text('scan')).toBe('reading'));
    expect(api.invoke.mock.calls.filter(([name]) => name === 'scan.state')).toHaveLength(1);

    act(() => api.emit('settings.changed', { uiScale: 1.5 } as never));
    await waitFor(() => expect(text('size')).toBe('1.5'));
  });

  it('follows the status event', async () => {
    mount();
    await waitFor(() => expect(text('status')).toBe('ready'));
    act(() => api.emit('library.status', { state: 'folder-missing', folder: 'D:\\Music' }));
    await waitFor(() => expect(text('status')).toBe('folder-missing'));
  });

  it('drops what it read from one folder, and any place in it, when another opens', async () => {
    mount();
    await waitFor(() => expect(text('albums')).toBe('Homogenic'));
    act(() => openAlbum(1));
    await waitFor(() => expect(text('place')).toBe('album'));

    albumTitles = ['From the other folder'];
    const other: LibraryStatus = { ...READY, folder: 'E:\\Other' };
    act(() => api.emit('library.status', other));

    await waitFor(() => expect(text('place')).toBe('tab'));
    await waitFor(() => expect(text('albums')).toBe('From the other folder'));
  });

  it('keeps the place when the same library comes back after being away', async () => {
    mount();
    await waitFor(() => expect(text('albums')).toBe('Homogenic'));
    act(() => openAlbum(1));

    act(() => api.emit('library.status', { state: 'folder-missing', folder: 'D:\\Music' }));
    act(() => api.emit('library.status', READY));

    await waitFor(() => expect(text('status')).toBe('ready'));
    expect(text('place')).toBe('album');
  });

  it('unsubscribes when it goes away', async () => {
    const { unmount } = mount();
    await waitFor(() => expect(text('status')).toBe('ready'));
    unmount();
    act(() => api.emit('library.status', { state: 'no-folder' }));
    expect(queryClient.getQueryData(statusQuery.queryKey)).toEqual(READY);
  });
});
