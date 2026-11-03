import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Settings } from '@/features/Settings/Settings';
import { reportWords } from '@/features/Settings/utils/reportWords';
import { currentPlace, useNavigation } from '@/lib/navigation';
import {
  closeSettings,
  currentPage,
  openSettings,
  showPage,
  useClosesSettingsWithThePages,
  type SettingsTab,
} from '@/lib/pages';
import { setPlayerState } from '@/lib/playerStore';
import { queryClient } from '@/lib/queryClient';
import {
  IDLE_SCAN,
  playerStateWith,
  resetRendererState,
  scanReport,
  storageInfo,
  stubApi,
  type StubbedApi,
} from '@/lib/testing';
import { useLibrarySync } from '@/lib/useLibrarySync';

function Mounted() {
  useLibrarySync();
  return <Settings />;
}

function mount(tab: SettingsTab | null = 'library') {
  act(() => openSettings(tab ?? undefined));
  return render(
    <QueryClientProvider client={queryClient}>
      <Mounted />
    </QueryClientProvider>,
  );
}

const REPLIES = {
  'library.status': { state: 'no-folder' as const },
  'scan.state': IDLE_SCAN,
  'system.storageInfo': storageInfo(),
  'scan.issues': [],
  'settings.get': { uiScale: 1.25 } as never,
  'system.revealPath': undefined as never,
  'scan.start': undefined as never,
  'library.chooseFolder': { state: 'no-folder' as const },
  'library.removeMissing': { removed: 3 },
  'settings.update': { uiScale: 1.3 } as never,
};

const section = (name: string) => screen.getByRole('region', { name });

let api: StubbedApi;

beforeEach(() => {
  resetRendererState();
  api = stubApi(REPLIES);
});

describe('Settings', () => {
  it('shows every number and path Storage knows', async () => {
    mount('library');
    await screen.findByRole('region', { name: 'Storage' });
    const text = section('Storage').textContent;

    expect(text).toContain('5,719');
    expect(text).toContain('682');
    expect(text).toContain('412');
    expect(text).toContain('D:\\Music\\.player\\library.db');
    expect(text).toContain('4.5 MB');
    expect(text).toContain('C:\\AppData\\art-cache');
    expect(text).toContain('433 MB');
    expect(text).toContain('C:\\AppData\\settings.json');
    expect(text).toContain('C:\\AppData\\logs');
    expect(text).toContain('Library last changed');
    expect(text).toContain('On THIS-PC at');
    expect(text).toContain('v0.41.0');
    expect(text).toContain('C:\\app\\mpv.exe');
    expect(text).toContain('6.0');
    expect(text).toContain('C:\\app\\ffmpeg.exe');
  });

  it('says what it could not find, rather than leaving a gap', async () => {
    api = stubApi({
      ...REPLIES,
      'system.storageInfo': storageInfo({
        libraryFolder: null,
        databasePath: null,
        databaseBytes: null,
        lastChanged: null,
        lastScanAt: null,
        engine: {
          mpvPath: 'C:\\app\\mpv.exe',
          mpvFound: false,
          mpvVersion: null,
          ffmpegPath: 'C:\\app\\ffmpeg.exe',
          ffmpegFound: false,
          ffmpegVersion: null,
        },
      }),
    });
    mount('library');
    await screen.findByRole('region', { name: 'Storage' });

    expect(section('Storage').textContent).toContain('Not found at C:\\app\\mpv.exe');
    expect(section('Storage').textContent).toContain("Isn't open");
    expect(screen.queryByRole('button', { name: 'Reveal the database' })).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Library' }));
    await screen.findByRole('region', { name: 'Library' });
    expect(section('Library').textContent).toContain('Not yet');
    expect(screen.queryByRole('button', { name: 'Reveal the library folder' })).toBeNull();
  });

  it('reveals through main, by target and never by path', async () => {
    mount('library');
    fireEvent.click(await screen.findByRole('button', { name: 'Reveal the database' }));
    expect(api.invoke).toHaveBeenCalledWith('system.revealPath', { target: 'database' });

    fireEvent.click(screen.getByRole('button', { name: 'Reveal the logs' }));
    expect(api.invoke).toHaveBeenCalledWith('system.revealPath', { target: 'logs' });
  });

  it('names the folder once', async () => {
    mount('library');
    await screen.findByRole('region', { name: 'Storage' });
    expect(section('Storage').textContent).not.toContain('Library folder');

    fireEvent.click(screen.getByRole('tab', { name: 'Library' }));
    await screen.findByRole('region', { name: 'Library' });
    expect(section('Library').textContent).toContain('D:\\Music');
    expect(within(section('Library')).getByRole('button', { name: 'Reveal the library folder' })).toBeTruthy();
  });

  it('Rescan and Change folder go to main', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Rescan' }));
    await waitFor(() => expect(api.invoke).toHaveBeenCalledWith('scan.start'));

    fireEvent.click(screen.getByRole('button', { name: 'Change folder' }));
    await waitFor(() => expect(api.invoke).toHaveBeenCalledWith('library.chooseFolder'));
  });

  it('Rescan is busy while a scan runs', async () => {
    api = stubApi({ ...REPLIES, 'scan.state': { ...IDLE_SCAN, phase: 'reading' } });
    mount();
    await waitFor(async () =>
      expect((await screen.findByRole('button', { name: 'Rescan' })).getAttribute('aria-busy')).toBe('true'),
    );
  });

  describe('the last scan', () => {
    it('shows what the scan found, and the time it took', async () => {
      api = stubApi({
        ...REPLIES,
        'scan.state': { ...IDLE_SCAN, lastReport: scanReport({ durationMs: 78_000, added: 5_719, issues: 47 }) },
      });
      mount();

      expect((await screen.findByTestId('scan-report')).textContent).toBe(
        '5,719 added, 47 with issues, took 1 min 18 s',
      );
    });

    it('a scan that changed nothing says how much it looked at', () => {
      expect(reportWords(scanReport({ unchanged: 5_719 }))).toBe('5,719 unchanged');
    });

    it('a cancelled scan says so', () => {
      expect(reportWords(scanReport({ cancelled: true, added: 2, moved: 1, restored: 3 }))).toBe(
        'Cancelled: 2 added, 1 moved, 3 back again',
      );
    });

    it('a folder that looked empty says that, not that nothing changed', () => {
      expect(reportWords(scanReport({ looksEmpty: true }))).toBe(
        'The folder looked empty, so nothing was marked missing',
      );
    });
  });

  describe('missing tracks', () => {
    const WITH_MISSING = {
      ...REPLIES,
      'system.storageInfo': storageInfo({ counts: { tracks: 10, albums: 1, artists: 1, missing: 3 } }),
    };

    it('nothing missing has nothing to do', async () => {
      mount();
      const missing = await screen.findByRole('region', { name: 'Missing files' });
      expect(missing.textContent).toContain('Every song in the library is in the folder');
      expect(screen.queryByRole('button', { name: 'Remove missing' })).toBeNull();
    });

    it('gets the grammar right for one', async () => {
      api = stubApi({
        ...REPLIES,
        'system.storageInfo': storageInfo({ counts: { tracks: 10, albums: 1, artists: 1, missing: 1 } }),
      });
      mount();
      const missing = await screen.findByRole('region', { name: 'Missing files' });
      expect(missing.textContent).toContain("1 track in the library isn't in the folder anymore");
    });

    it('shows them through the missing filter', async () => {
      api = stubApi(WITH_MISSING);
      mount();

      fireEvent.click(await screen.findByRole('button', { name: 'Show them' }));

      const { result } = renderHook(() => useNavigation(currentPlace));
      expect(result.current).toEqual({ kind: 'missing' });
      expect(currentPage()).toBe('library');
    });

    it('removing warns about playlists, and does nothing until confirmed', async () => {
      api = stubApi(WITH_MISSING);
      mount();

      fireEvent.click(await screen.findByRole('button', { name: 'Remove missing' }));

      const dialog = await screen.findByRole('dialog', { name: /^Remove/ });
      expect(dialog.textContent).toContain('3 tracks');
      expect(dialog.textContent).toContain('playlist');
      expect(api.invoke).not.toHaveBeenCalledWith('library.removeMissing');

      fireEvent.click(screen.getByRole('button', { name: 'Remove them' }));
      await waitFor(() => expect(api.invoke).toHaveBeenCalledWith('library.removeMissing'));
    });
  });

  describe('interface size', () => {
    it('shows the saved size, and changes it through main', async () => {
      mount('general');
      const slider = await screen.findByRole('slider', { name: 'Interface size' });
      expect(slider.getAttribute('aria-valuenow')).toBe('1.25');
      expect(screen.getByText('125%')).toBeTruthy();

      act(() => {
        slider.focus();
      });
      fireEvent.keyDown(slider, { key: 'ArrowRight' });

      expect(api.invoke).toHaveBeenCalledWith('settings.update', { uiScale: 1.3 });
      expect(screen.getByText('130%')).toBeTruthy();
    });

    it('a second step starts from the first, before main has answered', async () => {
      mount('general');
      const slider = await screen.findByRole('slider', { name: 'Interface size' });
      act(() => {
        slider.focus();
      });

      fireEvent.keyDown(slider, { key: 'ArrowRight' });
      fireEvent.keyDown(slider, { key: 'ArrowRight' });

      expect(api.invoke).toHaveBeenLastCalledWith('settings.update', { uiScale: 1.35 });
    });

    it('scrolls back to the slider when the new size has landed, and not before', async () => {
      const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
      mount('general');
      await screen.findByRole('slider', { name: 'Interface size' });
      expect(scrollIntoView).not.toHaveBeenCalled();

      act(() => api.emit('settings.changed', { uiScale: 1.5 } as never));

      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledOnce());
    });

    it('stops at what the window can take, and says so', async () => {
      const { innerHeight, innerWidth } = window;
      Object.defineProperties(window, {
        innerHeight: { configurable: true, value: 600 },
        innerWidth: { configurable: true, value: 1000 },
      });
      try {
        api = stubApi({ ...REPLIES, 'settings.get': { uiScale: 2 } as never });
        mount('general');

        expect(await screen.findByText('200%')).toBeTruthy();
        expect(screen.getByText(/only has room for 125%/)).toBeTruthy();
      } finally {
        Object.defineProperties(window, {
          innerHeight: { configurable: true, value: innerHeight },
          innerWidth: { configurable: true, value: innerWidth },
        });
      }
    });

    it('has nothing to add when the window has room', async () => {
      mount('general');
      await screen.findByRole('slider', { name: 'Interface size' });
      expect(screen.queryByText(/only has room for/)).toBeNull();
    });
  });

  describe('playback', () => {
    it('shows the ReplayGain mode main has, and says what it reads', async () => {
      setPlayerState(playerStateWith({ replayGainMode: 'track' }));
      mount('general');
      const playback = await screen.findByRole('region', { name: 'Playback' });

      expect(playback.textContent).toContain('foobar');
      expect(within(playback).getByRole('radio', { name: 'Track' }).getAttribute('aria-checked')).toBe('true');
      expect(within(playback).getByRole('radio', { name: 'Album' }).getAttribute('aria-checked')).toBe('false');
    });

    it('changes it through main, and shows the change when main says so', async () => {
      api = stubApi({ ...REPLIES, 'player.setReplayGainMode': undefined as never });
      mount('general');
      const playback = await screen.findByRole('region', { name: 'ReplayGain' });

      fireEvent.click(within(playback).getByRole('radio', { name: 'Off' }));

      expect(api.invoke).toHaveBeenCalledWith('player.setReplayGainMode', { mode: 'off' });
      expect(within(playback).getByRole('radio', { name: 'Off' }).getAttribute('aria-checked')).toBe('false');

      act(() => setPlayerState(playerStateWith({ replayGainMode: 'off' })));
      expect(within(playback).getByRole('radio', { name: 'Off' }).getAttribute('aria-checked')).toBe('true');
    });

    it('pressing the one that is on leaves it on, and tells main nothing', async () => {
      api = stubApi({ ...REPLIES, 'player.setReplayGainMode': undefined as never });
      mount('general');
      const playback = await screen.findByRole('region', { name: 'Playback' });

      fireEvent.click(within(playback).getByRole('radio', { name: 'Album' }));

      expect(api.invoke).not.toHaveBeenCalledWith('player.setReplayGainMode', expect.anything());
    });
  });

  describe('the tabs', () => {
    it('are one per concern, in order, and open on the one asked for', async () => {
      mount('data');
      const names = screen.getAllByRole('tab').map((tab) => tab.textContent);
      expect(names).toEqual(['General', 'Library', 'Library report', 'Seasons', 'Online and data', 'Stats']);
      expect(await screen.findByRole('region', { name: 'Lyrics' })).toBeTruthy();
    });

    it('hold the sections of what they are for', async () => {
      const inTab = async (name: string) => {
        fireEvent.click(screen.getByRole('tab', { name }));
        await act(() => Promise.resolve());
        return screen.queryAllByRole('region').map((region) => region.getAttribute('aria-label'));
      };
      mount('general');
      expect(await inTab('General')).toEqual(['Playback', 'ReplayGain', 'Stay awake', 'Interface size']);
      await inTab('Library');
      await screen.findByRole('region', { name: 'Library' });
      expect(await inTab('Library')).toEqual([
        'Library',
        'Folder',
        'Missing files',
        'Storage',
        'In the library',
        'Files',
        'Engine',
      ]);
      expect(await inTab('Online and data')).toEqual(
        expect.arrayContaining(['Lyrics', 'Lyrics online', 'Lyrics library']),
      );
    });

    it('put focus on the active tab, ready for the arrows', async () => {
      mount('general');
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'General' })));
    });

    it('keep their place for the next time it opens', async () => {
      const { unmount } = mount('library');
      await screen.findByRole('region', { name: 'Storage' });
      act(() => closeSettings());
      unmount();

      mount(null);
      expect(await screen.findByRole('region', { name: 'Storage' })).toBeTruthy();
    });

    it('go back to the page they were opened from', () => {
      act(() => showPage('discover'));
      mount('general');
      expect(currentPage()).toBe('settings');

      act(() => openSettings('library'));
      act(() => closeSettings());
      expect(currentPage()).toBe('discover');
    });

    it('close with the pages', () => {
      const { unmount } = renderHook(() => useClosesSettingsWithThePages());
      act(() => openSettings());
      unmount();
      expect(currentPage()).toBe('library');
    });
  });

  it('when storage cannot be read, offers to try again', async () => {
    api = stubApi({ ...REPLIES, 'system.storageInfo': { failure: 'unexpected', message: 'Something went wrong' } });
    mount();
    expect((await screen.findByRole('alert')).textContent).toContain('Something went wrong');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
