import { act, fireEvent, render, screen } from '@testing-library/react';
import { Profiler } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TrackRow } from '@/components/music/TrackRow';
import { setPlayerState } from '@/lib/playerStore';
import { bindSelection, pressRow, resetSelection } from '@/lib/selection';
import { playerStateWith, resetRendererState, track } from '@/lib/testing';

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
      const bars = () => [...screen.getByTestId('playing-bars').children];
      const isPaused = () => bars().map(({ className }) => className.includes('[animation-play-state:paused]'));

      afterEach(() => {
        resetRendererState();
      });

      it('run while it plays, and pause while it does not', () => {
        setPlayerState(playerStateWith({ status: 'playing', current: track() }));
        render(<TrackRow track={track()} onPlay={NOOP} />);
        expect(isPaused()).toEqual([false, false, false]);

        act(() => setPlayerState(playerStateWith({ status: 'paused', current: track() })));
        expect(isPaused()).toEqual([true, true, true]);

        act(() => setPlayerState(playerStateWith({ status: 'loading', current: track() })));
        expect(isPaused()).toEqual([true, true, true]);

        act(() => setPlayerState(playerStateWith({ status: 'playing', current: track() })));
        expect(isPaused()).toEqual([false, false, false]);
      });

      it('each have their own animation, and none under reduced motion', () => {
        setPlayerState(playerStateWith({ status: 'playing', current: track() }));
        render(<TrackRow track={track()} onPlay={NOOP} />);
        const animations = bars().map(({ className }) => /animate-bar-\w/.exec(className)?.[0]);
        expect(new Set(animations).size).toBe(3);
        for (const bar of bars()) expect(bar.className).toContain('motion-reduce:animate-none');
      });

      it('are only in the row that is current', () => {
        setPlayerState(playerStateWith({ status: 'playing', current: track({ id: 7 }) }));
        render(<TrackRow track={track({ id: 8 })} onPlay={NOOP} />);
        expect(screen.queryByTestId('playing-bars')).toBeNull();
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

    describe('with a selection', () => {
      function selectableRows() {
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
                <TrackRow track={row} selectionKey={`track-${row.id}`} onPlay={NOOP} />
              </Profiler>
            ))}
          </>,
        );
        commits.clear();
        return commits;
      }

      it('a change re-renders only the rows whose answer changed', () => {
        bindSelection(
          'list',
          ROWS.map(({ id }) => `track-${id}`),
        );
        const commits = selectableRows();

        act(() => void pressRow('track-3', { ctrl: true, shift: false }));
        expect([...commits.keys()]).toEqual(['3']);

        commits.clear();
        act(() => void pressRow('track-6', { ctrl: false, shift: true }));
        expect([...commits.keys()].toSorted()).toEqual(['4', '5', '6']);

        act(() => resetSelection());
      });
    });

    it('pausing reaches only the bars in the current row, and anything else none of them', () => {
      setPlayerState(playerStateWith({ status: 'playing', current: ROWS[3] ?? null }));
      const commits = mountedRows();

      act(() => setPlayerState(playerStateWith({ status: 'paused', current: ROWS[3] ?? null })));
      expect([...commits.keys()]).toEqual([String(ROWS[3]?.id)]);

      act(() => setPlayerState(playerStateWith({ status: 'playing', current: ROWS[3] ?? null })));
      commits.clear();
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
