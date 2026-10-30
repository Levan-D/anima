import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/app/App';
import { AppLayout } from '@/app/AppLayout';
import type * as AppLayoutModule from '@/app/AppLayout';
import { Toaster } from '@/components/ui/Toaster';
import { ScanProgress } from '@/features/ScanProgress/ScanProgress';
import type * as ScanProgressModule from '@/features/ScanProgress/ScanProgress';
import { SearchField } from '@/features/Search/SearchField';
import type * as SearchFieldModule from '@/features/Search/SearchField';
import { setListMetrics } from '@/lib/listMetrics';
import { openAlbum } from '@/lib/navigation';
import {
  album,
  IDLE_SCAN,
  NOTHING_FOUND,
  READY,
  resetRendererState,
  stubApi,
  stubLayout,
  track,
  type StubbedApi,
} from '@/lib/testing';

vi.mock('@/components/ui/Toaster', () => ({ Toaster: vi.fn(() => null) }));
vi.mock('@/app/AppLayout', async (importActual) => ({
  AppLayout: vi.fn((await importActual<typeof AppLayoutModule>()).AppLayout),
}));
vi.mock('@/features/ScanProgress/ScanProgress', async (importActual) => ({
  ScanProgress: vi.fn((await importActual<typeof ScanProgressModule>()).ScanProgress),
}));
vi.mock('@/features/Search/SearchField', async (importActual) => ({
  SearchField: vi.fn((await importActual<typeof SearchFieldModule>()).SearchField),
}));

const REPLIES = {
  'library.status': READY,
  'scan.state': IDLE_SCAN,
  'library.albums': [album()],
  'library.artists': [],
  'library.genres': [],
  'library.tracks': [track()],
  'library.album': album(),
  'library.search': NOTHING_FOUND,
  'system.logError': undefined as never,
  'settings.get': { uiScale: 1 } as never,
  'system.storageInfo': { failure: 'unexpected' as const, message: 'No storage in this test' },
};

let api: StubbedApi;

beforeEach(async () => {
  resetRendererState();
  stubLayout({ width: 480, height: 800 });
  setListMetrics({ row: 48, label: 42, card: 168, gap: 12, cardText: 44, gutter: 18 });
  vi.mocked(Toaster).mockReset();
  vi.mocked(AppLayout).mockReset();
  vi.mocked(ScanProgress).mockReset();
  vi.mocked(SearchField).mockReset();
  const { AppLayout: RealLayout } = await vi.importActual<typeof AppLayoutModule>('@/app/AppLayout');
  const { ScanProgress: RealProgress } = await vi.importActual<typeof ScanProgressModule>(
    '@/features/ScanProgress/ScanProgress',
  );
  const { SearchField: RealField } = await vi.importActual<typeof SearchFieldModule>('@/features/Search/SearchField');
  vi.mocked(AppLayout).mockImplementation(RealLayout);
  vi.mocked(ScanProgress).mockImplementation(RealProgress);
  vi.mocked(SearchField).mockImplementation(RealField);
  api = stubApi(REPLIES);
  // React logs every caught error to the console, which is noise here.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('App', () => {
  it('asks the gate first, and shows the panels once the library is ready', async () => {
    render(<App />);
    expect(screen.queryByRole('tab', { name: 'Albums' })).toBeNull();
    expect(await screen.findByRole('tab', { name: 'Albums' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('with no folder there are no panels at all', async () => {
    stubApi({ 'library.status': { state: 'no-folder' }, 'scan.state': IDLE_SCAN });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Point me at your music' })).toBeTruthy();
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('keeps the panels when the toasts break, and logs it', async () => {
    vi.mocked(Toaster).mockImplementation(() => {
      throw new Error('toaster blew up');
    });
    render(<App />);
    expect(await screen.findByRole('tab', { name: 'Albums' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(api.invoke).toHaveBeenCalledWith('system.logError', expect.objectContaining({ message: 'toaster blew up' }));
  });

  it('shows a way out instead of a blank window when the layout itself breaks', async () => {
    vi.mocked(AppLayout).mockImplementation(() => {
      throw new Error('layout blew up');
    });
    render(<App />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('the tabs switch what the list shows, and no tab is lit over search or settings', async () => {
    render(<App />);
    const albums = await screen.findByRole('tab', { name: 'Albums' });
    expect(albums.getAttribute('aria-selected')).toBe('true');

    fireEvent.click(screen.getByRole('tab', { name: 'Queue' }));
    expect(await screen.findByText('Nothing queued')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Queue' }).getAttribute('aria-selected')).toBe('true');

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'night' } });
    expect(await screen.findByText('Nothing matches “night”')).toBeTruthy();
    expect(screen.queryByRole('tab', { selected: true })).toBeNull();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(await screen.findByText('Nothing queued')).toBeTruthy();
  });

  it('the active tab takes you back to its root from anything drilled into', async () => {
    render(<App />);
    const albums = await screen.findByRole('tab', { name: 'Albums' });
    act(() => openAlbum(1));
    expect(await screen.findByRole('button', { name: 'Back' })).toBeTruthy();

    fireEvent.click(albums);

    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });

  it('Back and Escape go back, and Escape leaves alone what something on top has already used', async () => {
    render(<App />);
    await screen.findByRole('tab', { name: 'Albums' });

    act(() => openAlbum(1));
    fireEvent.click(await screen.findByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();

    act(() => openAlbum(1));
    await screen.findByRole('button', { name: 'Back' });
    const taken = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    taken.preventDefault();
    act(() => {
      window.dispatchEvent(taken);
    });
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });

  it('Escape over an open tooltip goes back as well as closing it', async () => {
    render(<App />);
    act(() => openAlbum(1));
    const back = await screen.findByRole('button', { name: 'Back' });
    fireEvent.focus(back);
    await screen.findByRole('tooltip', { hidden: true });

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Back' })).toBeNull());
  });

  describe('going from a tab to its list by keyboard', () => {
    it('Arrow Down on the active tab goes to the first thing in the list', async () => {
      render(<App />);
      const albums = await screen.findByRole('tab', { name: 'Albums' });
      await screen.findByTestId('album-card');
      act(() => albums.focus());

      fireEvent.keyDown(albums, { key: 'ArrowDown' });

      expect(document.activeElement).toBe(screen.getByTestId('album-card'));
    });

    it('Arrow Up on the first thing in the list comes back', async () => {
      render(<App />);
      const albums = await screen.findByRole('tab', { name: 'Albums' });
      await screen.findByTestId('album-card');
      act(() => screen.getByRole('list').focus());

      fireEvent.keyDown(screen.getByTestId('album-card'), { key: 'ArrowUp' });

      expect(document.activeElement).toBe(albums);
    });
  });

  describe('leaving search', () => {
    it('Escape from a result leaves focus somewhere the arrow keys work', async () => {
      api = stubApi({
        ...REPLIES,
        'library.search': { ...NOTHING_FOUND, albums: [album({ title: 'Found' })] },
      });
      render(<App />);
      const field = await screen.findByRole('searchbox');
      await screen.findByTestId('album-card');
      fireEvent.change(field, { target: { value: 'found' } });
      act(() => field.focus());
      await screen.findByText('Found');
      fireEvent.keyDown(field, { key: 'ArrowDown' });
      expect(document.activeElement).toBe(screen.getByText('Found').closest('button'));

      fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });

      await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('album-card')));
    });

    it('Escape in the field stays in the field, even with a row in the list to go back to', async () => {
      render(<App />);
      const field = await screen.findByRole('searchbox');
      const card = await screen.findByTestId('album-card');
      act(() => card.focus());
      fireEvent.change(field, { target: { value: 'found' } });
      act(() => field.focus());

      fireEvent.keyDown(field, { key: 'Escape' });

      await screen.findByTestId('album-card');
      expect(document.activeElement).toBe(field);
    });
  });

  describe('when one part of the column breaks', () => {
    it('losing the progress line leaves the tabs, the search field and the list', async () => {
      vi.mocked(ScanProgress).mockImplementation(() => {
        throw new Error('progress blew up');
      });
      render(<App />);

      expect(await screen.findByRole('tab', { name: 'Albums' })).toBeTruthy();
      expect(screen.getByRole('searchbox')).toBeTruthy();
      expect(await screen.findByTestId('album-card')).toBeTruthy();
      expect(screen.getAllByRole('alert')).toHaveLength(1);
    });

    it('losing the search field leaves the tabs and the list', async () => {
      vi.mocked(SearchField).mockImplementation(() => {
        throw new Error('search blew up');
      });
      render(<App />);

      expect(await screen.findByRole('tab', { name: 'Albums' })).toBeTruthy();
      expect(await screen.findByTestId('album-card')).toBeTruthy();
      expect(screen.getAllByRole('alert')).toHaveLength(1);
    });
  });

  it('the gear opens Settings, and closes it again', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('button', { name: 'Settings' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('button', { name: 'Settings' }).getAttribute('aria-pressed')).toBe('false');
  });
});
