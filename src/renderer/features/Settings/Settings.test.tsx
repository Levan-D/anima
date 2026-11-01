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
    mount('storage');
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
    mount('storage');
    await screen.findByRole('region', { name: 'Storage' });

    expect(section('Storage').textContent).toContain('Not found at C:\\app\\mpv.exe');
    expect(section('Storage').textContent).toContain("Isn't open");
    expect(screen.queryByRole('button', { name: 'Reveal the database' })).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Library' }));
    await screen.findByRole('region', { name: 'Library' });
    expect(section('Library').textContent).toContain('Not scanned yet');
    expect(screen.queryByRole('button', { name: 'Reveal the library folder' })).toBeNull();
  });

  it('reveals through main, by target and never by path', async () => {
    mount('storage');
    fireEvent.click(await screen.findByRole('button', { name: 'Reveal the database' }));
    expect(api.invoke).toHaveBeenCalledWith('system.revealPath', { target: 'database' });

    fireEvent.click(screen.getByRole('button', { name: 'Reveal log' }));
    expect(api.invoke).toHaveBeenCalledWith('system.revealPath', { target: 'logs' });
  });

  it('names the folder once', async () => {
    mount('storage');
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

  describe('issues', () => {
    const REASONS = {
      ...REPLIES,
      'scan.issues': [
        { relPath: 'Broken/corrupt.flac', kind: 'unreadable' as const, message: 'Invalid FLAC preamble' },
        { relPath: 'Untagged/a.flac', kind: 'bad_tags' as const, message: 'No title tag' },
        { relPath: 'Untagged/b.flac', kind: 'bad_tags' as const, message: 'No title tag' },
      ],
    };

    it('says one line per reason, with how many files share it', async () => {
      api = stubApi(REASONS);
      mount();

      const issues = await screen.findByTestId('scan-issues');
      expect(issues.textContent).toContain('3 files with issues');
      expect(issues.textContent).toContain('2 files · Tags are missing or damaged: No title tag');
      expect(issues.textContent).toContain("1 file · Couldn't be read: Invalid FLAC preamble");
      expect(issues.textContent).not.toContain('corrupt.flac');
    });

    it('with only the one reason, says how many once', async () => {
      api = stubApi({
        ...REPLIES,
        'scan.issues': [
          { relPath: 'a.flac', kind: 'bad_tags' as const, message: 'No title tag' },
          { relPath: 'b.flac', kind: 'bad_tags' as const, message: 'No title tag' },
        ],
      });
      mount();

      const issues = await screen.findByTestId('scan-issues');
      expect(issues.textContent).toContain('2 files with issues');
      expect(issues.textContent).toContain('Tags are missing or damaged: No title tag');
      expect(issues.textContent?.match(/2 files/g)).toHaveLength(1);
      expect(issues.textContent).not.toContain('.');
    });

    it('lists the files when asked', async () => {
      api = stubApi(REASONS);
      mount();

      fireEvent.click(await screen.findByRole('button', { name: 'Show the files' }));

      const issues = screen.getByTestId('scan-issues');
      expect(issues.textContent).toContain('Broken\\corrupt.flac');
      expect(issues.textContent).toContain('Untagged\\b.flac');
      expect(issues.textContent).not.toContain('/');

      fireEvent.click(screen.getByRole('button', { name: 'Hide the files' }));
      expect(issues.textContent).not.toContain('corrupt.flac');
    });

    it('keeps a long list short until asked', async () => {
      api = stubApi({
        ...REPLIES,
        'scan.issues': Array.from({ length: 25 }, (_, index) => ({
          relPath: `file ${index}.mp3`,
          kind: 'bad_tags' as const,
          message: 'No title tag',
        })),
      });
      mount();

      fireEvent.click(await screen.findByRole('button', { name: 'Show the files' }));
      const issues = screen.getByTestId('scan-issues');
      expect(issues.textContent).toContain('file 9.mp3');
      expect(issues.textContent).not.toContain('file 10.mp3');

      fireEvent.click(screen.getByRole('button', { name: 'Show 15 more files' }));
      expect(issues.textContent).toContain('file 24.mp3');
    });

    it('nothing wrong is worth saying', async () => {
      mount();
      expect(await screen.findByText('Every file read cleanly')).toBeTruthy();
    });

    it('says nothing about how files read before any scan has finished', async () => {
      api = stubApi({ ...REPLIES, 'system.storageInfo': storageInfo({ lastScanAt: null }) });
      mount();
      await screen.findByText('Not scanned yet');
      await act(() => Promise.resolve());
      expect(screen.queryByText('Every file read cleanly')).toBeNull();
    });

    it('says nothing about how files read when a scan found none', async () => {
      const nothing = { tracks: 0, albums: 0, artists: 0, missing: 0 };
      api = stubApi({ ...REPLIES, 'system.storageInfo': storageInfo({ counts: nothing }) });
      mount();
      await screen.findByRole('region', { name: 'Library' });
      await act(() => Promise.resolve());
      expect(screen.queryByText('Every file read cleanly')).toBeNull();
    });
  });

  describe('missing tracks', () => {
    const WITH_MISSING = {
      ...REPLIES,
      'system.storageInfo': storageInfo({ counts: { tracks: 10, albums: 1, artists: 1, missing: 3 } }),
    };

    it('nothing missing has nothing to do', async () => {
      mount();
      const missing = await screen.findByRole('region', { name: 'Missing' });
      expect(missing.textContent).toContain('Everything in the library is on this device');
      expect(screen.queryByRole('button', { name: 'Remove missing' })).toBeNull();
    });

    it('gets the grammar right for one', async () => {
      api = stubApi({
        ...REPLIES,
        'system.storageInfo': storageInfo({ counts: { tracks: 10, albums: 1, artists: 1, missing: 1 } }),
      });
      mount();
      const missing = await screen.findByRole('region', { name: 'Missing' });
      expect(missing.textContent).toContain("1 track in the library isn't on this device. It comes back by itself");
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
      mount('interface');
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
      mount('interface');
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
      mount('interface');
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
        mount('interface');

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
      mount('interface');
      await screen.findByRole('slider', { name: 'Interface size' });
      expect(screen.queryByText(/only has room for/)).toBeNull();
    });
  });

  describe('playback', () => {
    it('shows the ReplayGain mode main has, and says what it reads', async () => {
      setPlayerState(playerStateWith({ replayGainMode: 'track' }));
      mount('playback');
      const playback = await screen.findByRole('region', { name: 'Playback' });

      expect(playback.textContent).toContain('foobar');
      expect(within(playback).getByRole('radio', { name: 'Track' }).getAttribute('aria-checked')).toBe('true');
      expect(within(playback).getByRole('radio', { name: 'Album' }).getAttribute('aria-checked')).toBe('false');
    });

    it('changes it through main, and shows the change when main says so', async () => {
      api = stubApi({ ...REPLIES, 'player.setReplayGainMode': undefined as never });
      mount('playback');
      const playback = await screen.findByRole('region', { name: 'ReplayGain' });

      fireEvent.click(within(playback).getByRole('radio', { name: 'Off' }));

      expect(api.invoke).toHaveBeenCalledWith('player.setReplayGainMode', { mode: 'off' });
      expect(within(playback).getByRole('radio', { name: 'Off' }).getAttribute('aria-checked')).toBe('false');

      act(() => setPlayerState(playerStateWith({ replayGainMode: 'off' })));
      expect(within(playback).getByRole('radio', { name: 'Off' }).getAttribute('aria-checked')).toBe('true');
    });

    it('pressing the one that is on leaves it on, and tells main nothing', async () => {
      api = stubApi({ ...REPLIES, 'player.setReplayGainMode': undefined as never });
      mount('playback');
      const playback = await screen.findByRole('region', { name: 'Playback' });

      fireEvent.click(within(playback).getByRole('radio', { name: 'Album' }));

      expect(api.invoke).not.toHaveBeenCalledWith('player.setReplayGainMode', expect.anything());
    });
  });

  describe('the tabs', () => {
    it('are one per concern, in order, and open on the one asked for', async () => {
      mount('lyrics');
      const names = screen.getAllByRole('tab').map((tab) => tab.textContent);
      expect(names).toEqual(['Playback', 'Interface', 'Library', 'Lyrics', 'Data', 'Storage', 'Stats']);
      expect(await screen.findByRole('region', { name: 'Lyrics' })).toBeTruthy();
    });

    it('hold the sections of what they are for', async () => {
      const inTab = async (name: string) => {
        fireEvent.click(screen.getByRole('tab', { name }));
        await act(() => Promise.resolve());
        return screen.queryAllByRole('region').map((region) => region.getAttribute('aria-label'));
      };
      mount('playback');
      expect(await inTab('Playback')).toEqual(['Playback', 'ReplayGain', 'Stay awake']);
      expect(await inTab('Interface')).toEqual(['Interface size']);
      await inTab('Library');
      await screen.findByRole('region', { name: 'Library' });
      expect(await inTab('Library')).toEqual(['Library', 'Folder', 'Scan', 'Missing']);
      expect(await inTab('Lyrics')).toEqual(['Lyrics', 'Online', 'Lyrics library']);
      await inTab('Storage');
      await screen.findByRole('region', { name: 'Storage' });
      expect(await inTab('Storage')).toEqual(['Storage', 'In the library', 'Files', 'Engine']);
    });

    it('put focus on the active tab, ready for the arrows', async () => {
      mount('interface');
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Interface' })));
    });

    it('keep their place for the next time it opens', async () => {
      const { unmount } = mount('storage');
      await screen.findByRole('region', { name: 'Storage' });
      act(() => closeSettings());
      unmount();

      mount(null);
      expect(await screen.findByRole('region', { name: 'Storage' })).toBeTruthy();
    });

    it('go back to the page they were opened from', () => {
      act(() => showPage('discover'));
      mount('playback');
      expect(currentPage()).toBe('settings');

      act(() => openSettings('storage'));
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
