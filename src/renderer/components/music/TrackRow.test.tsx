import { act, fireEvent, render, screen } from '@testing-library/react';
import { Profiler } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TrackRow } from '@/components/music/TrackRow';
import { PAINT_EVERY_MS, startPlayerPositionSync } from '@/lib/playerPosition';
import { setPlayerState } from '@/lib/playerStore';
import { playerStateWith, resetRendererState, stubApi, track, type StubbedApi } from '@/lib/testing';
import { startWindowVisibilitySync } from '@/lib/windowVisibility';

const NOOP = () => {};

/** A click as the browser sends it: which kind of pointer, and how many in a row. A key press comes with neither. */
function click(element: Element, pointerType: string, detail: number): void {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, detail });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  fireEvent(element, event);
}

beforeEach(() => {
  resetRendererState();
});

describe('TrackRow', () => {
  it('shows art, the title, the artist and album, and the duration', () => {
    const { container } = render(<TrackRow track={track()} onPlay={NOOP} />);
    expect(container.querySelector('img')).toBeTruthy();
    expect(screen.getByText('Jóga')).toBeTruthy();
    expect(screen.getByRole('button').textContent).toContain('Björk · Homogenic');
    expect(screen.getByText('5:05')).toBeTruthy();
  });

  it('handles a track with no album, number or year', () => {
    render(<TrackRow track={track({ album: null, albumId: null, trackNumber: null, year: null })} onPlay={NOOP} />);
    expect(screen.getByRole('button').textContent).not.toContain(' · ');
  });

  it('names the whole title for when the row cuts it off', () => {
    render(<TrackRow track={track({ title: 'A title far too long for any row' })} onPlay={NOOP} />);
    expect(screen.getByRole('button').getAttribute('title')).toBe('A title far too long for any row');
  });

  it('cuts right-to-left text from its end, not its beginning', () => {
    render(<TrackRow track={track({ title: 'אבג' })} onPlay={NOOP} />);
    expect(screen.getByText('אבג').getAttribute('dir')).toBe('auto');
  });

  describe('playing it', () => {
    function mounted() {
      const onPlay = vi.fn();
      const song = track();
      render(<TrackRow track={song} onPlay={onPlay} />);
      return { onPlay, song, row: screen.getByRole('button') };
    }

    it('one click of a mouse only picks it', () => {
      const { onPlay, row } = mounted();
      click(row, 'mouse', 1);
      expect(onPlay).not.toHaveBeenCalled();
    });

    it('two clicks of a mouse play it, once', () => {
      const { onPlay, song, row } = mounted();
      click(row, 'mouse', 1);
      click(row, 'mouse', 2);
      expect(onPlay).toHaveBeenCalledOnce();
      expect(onPlay).toHaveBeenCalledWith(song, null);
    });

    it('a third click does not start it over', () => {
      const { onPlay, row } = mounted();
      click(row, 'mouse', 1);
      click(row, 'mouse', 2);
      click(row, 'mouse', 3);
      expect(onPlay).toHaveBeenCalledOnce();
    });

    it('one tap of a finger or a pen plays it', () => {
      const { onPlay, row } = mounted();
      click(row, 'touch', 1);
      expect(onPlay).toHaveBeenCalledOnce();
      click(row, 'pen', 1);
      expect(onPlay).toHaveBeenCalledTimes(2);
    });

    it('a quick second tap does not play it twice', () => {
      const { onPlay, row } = mounted();
      click(row, 'touch', 1);
      click(row, 'touch', 2);
      expect(onPlay).toHaveBeenCalledOnce();
    });

    it('Enter plays it, which reaches a button as a click with no pointer and no count', () => {
      const { onPlay, row } = mounted();
      click(row, '', 0);
      expect(onPlay).toHaveBeenCalledOnce();
    });
  });

  describe('a track that is not on this device', () => {
    it('is grey, says why, and starts from nothing', () => {
      const onPlay = vi.fn();
      render(<TrackRow track={track({ isMissing: true })} onPlay={onPlay} />);
      const row = screen.getByRole('button');

      expect(row.getAttribute('aria-disabled')).toBe('true');
      expect(row.textContent).toContain('Not on this device');
      expect(row.textContent).not.toContain('Björk');

      click(row, 'touch', 1);
      click(row, '', 0);
      click(row, 'mouse', 2);
      expect(onPlay).not.toHaveBeenCalled();
    });

    it('says so in an album too, where a row usually has no second line', () => {
      render(<TrackRow track={track({ isMissing: true })} numbered onPlay={NOOP} />);
      expect(screen.getByRole('button').textContent).toContain('Not on this device');
    });
  });

  describe('being the current track', () => {
    it('is marked, in the accent, with bars, by id', () => {
      setPlayerState(playerStateWith({ status: 'playing', current: track({ id: 7 }) }));
      render(<TrackRow track={track({ id: 7 })} onPlay={NOOP} />);
      const row = screen.getByRole('button');

      expect(row.getAttribute('aria-current')).toBe('true');
      expect(screen.getByText('Jóga').className).toContain('text-accent');
      expect(screen.getByTestId('playing-bars')).toBeTruthy();
    });

    it('any other row is left alone', () => {
      setPlayerState(playerStateWith({ status: 'playing', current: track({ id: 7 }) }));
      render(<TrackRow track={track({ id: 8 })} onPlay={NOOP} />);

      expect(screen.getByRole('button').getAttribute('aria-current')).toBeNull();
      expect(screen.queryByTestId('playing-bars')).toBeNull();
    });

    describe('the bars', () => {
      const VISIBLE = { isFullscreen: false, isMiniPlayer: false, isHidden: false };
      const bar = () => screen.getByTestId('playing-bars').firstElementChild as HTMLElement;
      let api: StubbedApi;

      /** Whether a bar changes over a stretch of time. */
      function moves(): boolean {
        const before = bar().style.transform;
        act(() => {
          vi.advanceTimersByTime(600);
        });
        return bar().style.transform !== before;
      }

      beforeEach(() => {
        vi.useFakeTimers({
          toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout'],
        });
        document.documentElement.style.setProperty('--dur-loop', '1800ms');
        api = stubApi({ 'player.position': { loadId: 0, positionMs: 0 }, 'window.state': VISIBLE });
        startPlayerPositionSync();
        startWindowVisibilitySync();
      });

      afterEach(() => {
        api.emit('window.state', VISIBLE);
        resetRendererState();
        vi.useRealTimers();
        document.documentElement.style.removeProperty('--dur-loop');
      });

      it('move while it plays, and hold still while it does not', () => {
        setPlayerState(playerStateWith({ status: 'playing', current: track() }));
        render(<TrackRow track={track()} onPlay={NOOP} />);
        expect(moves()).toBe(true);

        act(() => setPlayerState(playerStateWith({ status: 'paused', current: track() })));
        expect(moves()).toBe(false);

        act(() => setPlayerState(playerStateWith({ status: 'loading', current: track() })));
        expect(moves()).toBe(false);

        act(() => setPlayerState(playerStateWith({ status: 'playing', current: track() })));
        expect(moves()).toBe(true);
      });

      it('stop in a hidden window, and start again when it comes back', () => {
        setPlayerState(playerStateWith({ status: 'playing', current: track() }));
        render(<TrackRow track={track()} onPlay={NOOP} />);

        act(() => api.emit('window.state', { ...VISIBLE, isHidden: true }));
        expect(moves()).toBe(false);
        expect(vi.getTimerCount()).toBe(0);

        act(() => api.emit('window.state', VISIBLE));
        expect(moves()).toBe(true);
      });

      it('wake the window no more than the seekbar does', () => {
        setPlayerState(playerStateWith({ status: 'playing', current: track() }));
        render(<TrackRow track={track()} onPlay={NOOP} />);
        const writes = vi.fn();
        const observer = new MutationObserver(writes);
        observer.observe(bar(), { attributes: true, attributeFilter: ['style'] });

        act(() => {
          vi.advanceTimersByTime(1000);
        });
        observer.takeRecords().forEach(writes);
        observer.disconnect();

        expect(writes.mock.calls.length).toBeLessThanOrEqual(1000 / PAINT_EVERY_MS);
      });

      it('hold still under reduced motion, where the token is zero', () => {
        document.documentElement.style.setProperty('--dur-loop', '0s');
        setPlayerState(playerStateWith({ status: 'playing', current: track() }));
        render(<TrackRow track={track()} onPlay={NOOP} />);
        expect(moves()).toBe(false);
      });

      it('leave nothing running when the row goes', () => {
        setPlayerState(playerStateWith({ status: 'playing', current: track() }));
        const { unmount } = render(<TrackRow track={track()} onPlay={NOOP} />);
        expect(vi.getTimerCount()).toBe(1);

        unmount();

        expect(vi.getTimerCount()).toBe(0);
      });

      it('only move in the row that is current', () => {
        setPlayerState(playerStateWith({ status: 'playing', current: track({ id: 7 }) }));
        render(<TrackRow track={track({ id: 8 })} onPlay={NOOP} />);
        expect(vi.getTimerCount()).toBe(0);
      });
    });

    it('in an album the bars take the place of the number', () => {
      setPlayerState(playerStateWith({ status: 'playing', current: track({ trackNumber: 7 }) }));
      render(<TrackRow track={track({ trackNumber: 7 })} numbered onPlay={NOOP} />);
      expect(screen.getByTestId('playing-bars')).toBeTruthy();
      expect(screen.queryByText('7')).toBeNull();
    });

    it('in the queue it goes by place, because the same track can be there twice', () => {
      setPlayerState(playerStateWith({ status: 'playing', current: track(), queueIndex: 2 }));
      render(
        <>
          <TrackRow track={track({ title: 'Earlier' })} queueIndex={0} onPlay={NOOP} />
          <TrackRow track={track({ title: 'Now' })} queueIndex={2} onPlay={NOOP} />
        </>,
      );
      expect(screen.getByText('Earlier').closest('button')?.getAttribute('aria-current')).toBeNull();
      expect(screen.getByText('Now').closest('button')?.getAttribute('aria-current')).toBe('true');
    });

    it('in the queue it hands back its place along with the track', () => {
      const onPlay = vi.fn();
      const song = track();
      render(<TrackRow track={song} queueIndex={4} onPlay={onPlay} />);
      click(screen.getByRole('button'), '', 0);
      expect(onPlay).toHaveBeenCalledWith(song, 4);
    });
  });

  describe('what a change of state costs', () => {
    const ROWS = Array.from({ length: 60 }, (_, index) => track({ id: index + 1, title: `Track ${index + 1}` }));

    function mountedRows() {
      const commits = new Map<string, number>();
      render(
        <>
          {ROWS.map((row) => (
            <Profiler
              key={row.id}
              id={String(row.id)}
              onRender={(id) => {
                commits.set(id, (commits.get(id) ?? 0) + 1);
              }}
            >
              <TrackRow track={row} onPlay={NOOP} />
            </Profiler>
          ))}
        </>,
      );
      commits.clear();
      return commits;
    }

    it('a new track re-renders only the row it left and the row it went to', () => {
      setPlayerState(playerStateWith({ status: 'playing', current: ROWS[3] ?? null }));
      const commits = mountedRows();

      act(() => setPlayerState(playerStateWith({ status: 'playing', current: ROWS[4] ?? null })));

      expect([...commits.keys()].toSorted()).toEqual(['4', '5']);
    });

    it('anything else re-renders none of them, pausing included', () => {
      setPlayerState(playerStateWith({ status: 'playing', current: ROWS[3] ?? null }));
      const commits = mountedRows();

      act(() => setPlayerState(playerStateWith({ status: 'paused', current: ROWS[3] ?? null })));
      act(() => setPlayerState(playerStateWith({ status: 'playing', current: ROWS[3] ?? null, volume: 40 })));
      act(() => setPlayerState(playerStateWith({ status: 'playing', current: ROWS[3] ?? null, queueVersion: 9 })));

      expect(commits.size).toBe(0);
    });
  });

  describe('in one album', () => {
    it('lets the title take two lines when there is no second line to share the row with', () => {
      render(<TrackRow track={track()} numbered onPlay={NOOP} />);
      expect(screen.getByText('Jóga').className).toContain('line-clamp-2');
      expect(screen.getByText('Jóga').className).not.toContain('truncate');
    });

    it('keeps a guest track to one line of title', () => {
      render(<TrackRow track={track({ artist: 'Guest', albumArtist: 'Host' })} numbered onPlay={NOOP} />);
      expect(screen.getByText('Jóga').className).toContain('truncate');
    });

    it('shows the number where the art was, and no second line', () => {
      const { container } = render(<TrackRow track={track({ trackNumber: 7 })} numbered onPlay={NOOP} />);
      expect(container.querySelector('img')).toBeNull();
      expect(screen.getByText('7')).toBeTruthy();
      expect(screen.queryByText(/Björk/)).toBeNull();
    });

    it('names the artist only when it is a guest', () => {
      render(<TrackRow track={track({ artist: 'Guest', albumArtist: 'Various Artists' })} numbered onPlay={NOOP} />);
      expect(screen.getByText('Guest')).toBeTruthy();
    });

    it('leaves the number blank when there is none', () => {
      render(<TrackRow track={track({ trackNumber: null })} numbered onPlay={NOOP} />);
      expect(screen.getByRole('button').textContent).toMatch(/^Jóga/);
    });
  });
});
