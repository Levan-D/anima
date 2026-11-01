import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicSection } from '@/components/music/listItems';
import { MusicList } from '@/components/music/MusicList';
import { Button } from '@/components/ui/Button';
import { recallList, rememberScroll } from '@/lib/listMemory';
import { setListMetrics } from '@/lib/listMetrics';
import { currentPlace, useNavigation } from '@/lib/navigation';
import { album, resetRendererState, stubApi, stubLayout, track } from '@/lib/testing';

const manyTracks = Array.from({ length: 5_700 }, (_, index) => track({ id: index + 1, title: `Track ${index + 1}` }));
const TRACKS: MusicSection[] = [{ kind: 'tracks', tracks: manyTracks, numbered: false }];

beforeEach(() => {
  resetRendererState();
  stubLayout({ width: 480, height: 480 });
  setListMetrics({ row: 48, label: 42, card: 168, gap: 12, cardText: 44, gutter: 18, listFade: 22 });
});

describe('MusicList', () => {
  it('renders what fits in the window out of thousands', () => {
    render(<MusicList label="Tracks" memoryKey="tracks" sections={TRACKS} />);
    const rows = screen.getAllByTestId('list-row');
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.length).toBeLessThan(40);
    expect(screen.getByText('Track 1')).toBeTruthy();
    expect(screen.queryByText('Track 5700')).toBeNull();
  });

  it('makes the list as tall as all its rows, at the height the token measured', () => {
    render(<MusicList label="Tracks" memoryKey="tracks" sections={TRACKS} />);
    const list = screen.getByRole('list', { name: 'Tracks' });
    expect(Number.parseFloat(list.style.height)).toBe(12 + 5_700 * 48 + 22);
  });

  it('follows a new row height without being remounted', () => {
    render(<MusicList label="Tracks" memoryKey="tracks" sections={TRACKS} />);
    const list = screen.getByRole('list', { name: 'Tracks' });

    act(() => setListMetrics({ row: 60, label: 42, card: 168, gap: 12, cardText: 44, gutter: 18, listFade: 22 }));

    expect(screen.getByRole('list', { name: 'Tracks' })).toBe(list);
    expect(Number.parseFloat(list.style.height)).toBe(12 + 5_700 * 60 + 22);
  });

  it('lays album cards out in lanes, with a short last row keeping its width', () => {
    const albums = [1, 2, 3].map((id) => album({ id, title: `Album ${id}` }));
    render(
      <MusicList
        label="Albums"
        memoryKey="albums"
        sections={[{ kind: 'albums', albums, hideArtist: false }]}
        onOpenAlbum={() => {}}
      />,
    );

    const lastRow = screen.getByText('Album 3').closest('[data-index]') as HTMLElement;
    expect(lastRow.querySelectorAll('button')).toHaveLength(1);
    expect(lastRow.querySelector('span[aria-hidden].min-w-0.flex-1')).toBeTruthy();
    expect(screen.getByText('Album 1').closest('[data-index]')).toBe(
      screen.getByText('Album 2').closest('[data-index]'),
    );
  });

  it('calls back with what was pressed', () => {
    const onOpenAlbum = vi.fn();
    const onPlayTrack = vi.fn();
    const song = track({ id: 9, title: 'A song' });
    render(
      <MusicList
        label="Mixed"
        memoryKey="mixed"
        sections={[
          { kind: 'albums', albums: [album({ id: 4, title: 'An album' })], hideArtist: false },
          { kind: 'tracks', tracks: [song], numbered: false },
        ]}
        onOpenAlbum={onOpenAlbum}
        onPlayTrack={onPlayTrack}
      />,
    );

    fireEvent.click(screen.getByText('An album'));
    fireEvent.click(screen.getByText('A song'));

    expect(onOpenAlbum).toHaveBeenCalledWith(4);
    expect(onPlayTrack).toHaveBeenCalledWith(song, null);
  });

  it('a queue gives each row its place, so the same track can be in it twice', () => {
    const onPlayTrack = vi.fn();
    const song = track({ id: 9, title: 'A song' });
    render(
      <MusicList
        label="Queue"
        memoryKey="queue"
        sections={[
          {
            kind: 'queue',
            items: [
              { queueId: 11, track: song },
              { queueId: 12, track: song },
            ],
          },
        ]}
        onPlayTrack={onPlayTrack}
      />,
    );

    const [, second] = screen.getAllByText('A song');
    fireEvent.click(second as Element);

    expect(onPlayTrack).toHaveBeenCalledWith(song, 1);
  });

  describe('the menu on a track row', () => {
    const song = track({ id: 9, title: 'A song', albumId: 4 });
    const SECTIONS: MusicSection[] = [
      { kind: 'label', text: 'Tracks' },
      { kind: 'albumRows', albums: [album({ id: 4, title: 'An album' })] },
      { kind: 'tracks', tracks: [song], numbered: false },
    ];

    function mount(props: Partial<ComponentProps<typeof MusicList>> = {}) {
      const onPlayTrack = vi.fn();
      const api = stubApi({ 'player.enqueue': undefined as never });
      render(<MusicList label="Mixed" memoryKey="mixed" sections={SECTIONS} onPlayTrack={onPlayTrack} {...props} />);
      return { api, onPlayTrack };
    }

    const items = () => screen.getAllByRole('menuitem').map(({ textContent }) => textContent);

    it('opens on a right-click on a track, with what can be done with it', async () => {
      mount();
      fireEvent.contextMenu(screen.getByText('A song'));
      await screen.findByRole('menu');
      expect(items()).toEqual([
        'Play',
        'Play next',
        'Add to queue',
        'More like this',
        'Radio from this track',
        'Add to playlist',
        'Reveal in File Explorer',
        'Go to album',
      ]);
    });

    it('stays shut on anything that is not a track', () => {
      mount();
      fireEvent.contextMenu(screen.getByText('An album'));
      expect(screen.queryByRole('menu')).toBeNull();
      fireEvent.contextMenu(screen.getByText('Tracks'));
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('Play plays that row', async () => {
      const { onPlayTrack } = mount();
      fireEvent.contextMenu(screen.getByText('A song'));
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Play' }));
      expect(onPlayTrack).toHaveBeenCalledWith(song, null);
    });

    it.each([
      ['Play next', 'next'],
      ['Add to queue', 'after-added'],
    ])('%s puts it in the queue, by id', async (name, where) => {
      const { api } = mount();
      fireEvent.contextMenu(screen.getByText('A song'));
      fireEvent.click(await screen.findByRole('menuitem', { name }));
      expect(api.invoke).toHaveBeenCalledWith('player.enqueue', { trackIds: [9], where });
    });

    it('Go to album goes there', async () => {
      mount();
      fireEvent.contextMenu(screen.getByText('A song'));
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Go to album' }));
      expect(renderHook(() => useNavigation(currentPlace)).result.current).toEqual({ kind: 'album', albumId: 4 });
    });

    it('a list that is all one album does not offer to go to it', async () => {
      mount({ sections: [{ kind: 'tracks', tracks: [song], numbered: true }] });
      fireEvent.contextMenu(screen.getByText('A song'));
      await screen.findByRole('menu');
      expect(items()).toEqual([
        'Play',
        'Play next',
        'Add to queue',
        'More like this',
        'Radio from this track',
        'Add to playlist',
        'Reveal in File Explorer',
      ]);
    });

    it('a missing track can be gone to, and can not be played or queued', async () => {
      const gone = track({ id: 3, title: 'Gone', isMissing: true, albumId: null, artistId: 8 });
      mount({ sections: [{ kind: 'tracks', tracks: [gone], numbered: false }] });
      // A disabled row takes no pointer, so the press lands on what's around it.
      fireEvent.contextMenu(screen.getByText('Gone').closest('[data-index]') as Element);
      await screen.findByRole('menu');
      for (const name of ['Play', 'Play next', 'Add to queue']) {
        expect(screen.getByRole('menuitem', { name }).getAttribute('aria-disabled')).toBe('true');
      }
      expect(screen.getByRole('menuitem', { name: 'Go to artist' }).getAttribute('aria-disabled')).toBeNull();
    });

    it('a list can offer something else', async () => {
      const onSelect = vi.fn();
      mount({ menuFor: () => [{ kind: 'item', label: 'Something else', onSelect }] });
      fireEvent.contextMenu(screen.getByText('A song'));
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Something else' }));
      expect(onSelect).toHaveBeenCalledOnce();
    });
  });

  it('hides the artist on a card when the whole list is one artist', () => {
    render(
      <MusicList
        label="Albums"
        memoryKey="albums"
        sections={[{ kind: 'albums', albums: [album({ artist: 'Björk', year: 1997 })], hideArtist: true }]}
      />,
    );
    expect(screen.getByText('1997')).toBeTruthy();
    expect(screen.queryByText(/Björk/)).toBeNull();
  });

  it('remembers where it was scrolled to, and goes back there when it mounts again', () => {
    const first = render(<MusicList label="Tracks" memoryKey="tracks" sections={TRACKS} />);
    const scroller = screen.getByTestId('list-scroller');
    Object.defineProperty(scroller, 'scrollTop', { configurable: true, value: 2_400 });
    fireEvent.scroll(scroller);
    expect(recallList('tracks').top).toBe(2_400);
    first.unmount();

    render(<MusicList label="Tracks" memoryKey="tracks" sections={TRACKS} />);

    // Rows around the remembered position are there on the first paint, not the top of the list.
    expect(screen.getByText('Track 50')).toBeTruthy();
    expect(screen.queryByText('Track 1')).toBeNull();
  });

  it('keeps the same rows in view through a change of row height', () => {
    rememberScroll('tracks', 4_800);
    render(<MusicList label="Tracks" memoryKey="tracks" sections={TRACKS} />);
    const scroller = screen.getByTestId('list-scroller');

    act(() => setListMetrics({ row: 96, label: 42, card: 168, gap: 12, cardText: 44, gutter: 18, listFade: 22 }));

    expect(scroller.scrollTop).toBeGreaterThan(9_500);
    expect(scroller.scrollTop).toBeLessThan(9_700);
  });

  describe('a position remembered at other sizes', () => {
    const atRowHeight = (row: number) =>
      setListMetrics({ row, label: 42, card: 168, gap: 12, cardText: 44, gutter: 18, listFade: 22 });

    function scrolledThenLeft(top: number): void {
      const first = render(<MusicList label="Tracks" memoryKey="tracks" sections={TRACKS} />);
      const scroller = screen.getByTestId('list-scroller');
      scroller.scrollTop = top;
      fireEvent.scroll(scroller);
      first.unmount();
    }

    it('keeps the same rows in view when the size changed while the list was gone', () => {
      scrolledThenLeft(4_800);
      atRowHeight(96);

      render(<MusicList label="Tracks" memoryKey="tracks" sections={TRACKS} />);

      const { scrollTop } = screen.getByTestId('list-scroller');
      expect(scrollTop).toBeGreaterThan(9_500);
      expect(scrollTop).toBeLessThan(9_700);
    });

    it('takes the position as it is when the size is the same', () => {
      scrolledThenLeft(4_800);
      render(<MusicList label="Tracks" memoryKey="tracks" sections={TRACKS} />);
      expect(screen.getByTestId('list-scroller').scrollTop).toBe(4_800);
    });

    it('does not drift when the list grew while it was gone', () => {
      scrolledThenLeft(4_800);
      const more: MusicSection[] = [
        { kind: 'tracks', tracks: [...manyTracks, track({ id: 9_999, title: 'New' })], numbered: false },
      ];
      render(<MusicList label="Tracks" memoryKey="tracks" sections={more} />);
      expect(screen.getByTestId('list-scroller').scrollTop).toBe(4_800);
    });
  });

  it('leaves the scroll position alone when the list grows', () => {
    const { rerender } = render(<MusicList label="Tracks" memoryKey="tracks" sections={TRACKS} />);
    const scroller = screen.getByTestId('list-scroller');
    scroller.scrollTop = 1_000;

    const more: MusicSection[] = [
      { kind: 'tracks', tracks: [...manyTracks, track({ id: 9_999, title: 'New' })], numbered: false },
    ];
    rerender(<MusicList label="Tracks" memoryKey="tracks" sections={more} />);

    expect(scroller.scrollTop).toBe(1_000);
  });

  it('gives a keyboard one tab stop, and the arrow keys walk the rows', () => {
    render(<MusicList label="Tracks" memoryKey="tracks" sections={TRACKS} />);
    const rows = screen.getAllByTestId('list-row');
    for (const row of rows) expect(row.getAttribute('tabindex')).toBe('-1');

    const list = screen.getByRole('list', { name: 'Tracks' });
    expect(list.getAttribute('tabindex')).toBe('0');

    act(() => list.focus());
    expect(document.activeElement).toBe(rows[0]);
    expect(list.getAttribute('tabindex')).toBe('-1');

    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[1]);

    act(() => (document.activeElement as HTMLElement).blur());
    expect(list.getAttribute('tabindex')).toBe('0');
  });

  it('never makes the scroller a tab stop of its own', () => {
    render(<MusicList label="Tracks" memoryKey="tracks" sections={TRACKS} />);
    expect(screen.getByTestId('list-scroller').getAttribute('tabindex')).toBe('-1');
  });

  describe('Page Up and Page Down', () => {
    function focusedRowAfter(key: string, times: number, start = 0): number {
      const list = screen.getByRole('list', { name: 'Tracks' });
      act(() => list.focus());
      for (let index = 0; index < start; index++) {
        fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' });
      }
      for (let press = 0; press < times; press++) fireEvent.keyDown(document.activeElement as Element, { key });
      return Number(document.activeElement?.closest('[data-index]')?.getAttribute('data-index'));
    }

    it('moves a screenful less one, from the very first press', () => {
      render(<MusicList label="Tracks" memoryKey="tracks" sections={TRACKS} />);
      // 480px of list at 48px a row.
      expect(focusedRowAfter('PageDown', 1)).toBe(9);
    });

    it('moves the same distance back', () => {
      render(<MusicList label="Tracks" memoryKey="tracks" sections={TRACKS} />);
      expect(focusedRowAfter('PageUp', 1, 12)).toBe(3);
    });
  });

  describe('at the top of the list', () => {
    it('Home goes all the way up, past the padding', () => {
      render(<MusicList label="Tracks" memoryKey="tracks" sections={TRACKS} />);
      const list = screen.getByRole('list', { name: 'Tracks' });
      const scroller = screen.getByTestId('list-scroller');
      const scrollTo = vi.fn();
      scroller.scrollTo = scrollTo;
      act(() => list.focus());
      fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' });
      scrollTo.mockClear();

      fireEvent.keyDown(document.activeElement as Element, { key: 'Home' });

      expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 0 }));
    });

    it('Home goes past a heading as well, however far down it started', () => {
      const sections: MusicSection[] = [{ kind: 'label', text: 'Disc 1' }, ...TRACKS];
      render(<MusicList label="Tracks" memoryKey="tracks" sections={sections} />);
      const scroller = screen.getByTestId('list-scroller');
      const scrollTo = vi.fn();
      scroller.scrollTo = scrollTo;
      act(() => screen.getByRole('list', { name: 'Tracks' }).focus());
      fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' });
      // The virtualizer goes by this to stop at the bottom, and jsdom has it at 0.
      Object.defineProperty(scroller, 'scrollHeight', { value: 300_000 });
      scroller.scrollTop = 1_000;
      fireEvent.scroll(scroller);
      scrollTo.mockClear();

      fireEvent.keyDown(document.activeElement as Element, { key: 'Home' });

      expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 0 }));
    });

    it('Arrow Up on the first row leaves for the active tab', () => {
      render(
        <>
          <Button role="tab" data-state="active">
            Tracks
          </Button>
          <div role="tabpanel">
            <MusicList label="Tracks" memoryKey="tracks" sections={TRACKS} />
          </div>
        </>,
      );
      act(() => screen.getByRole('list', { name: 'Tracks' }).focus());

      fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowUp' });

      expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Tracks' }));
    });
  });

  describe('when a refresh remounts what has focus', () => {
    const albums = (...ids: number[]) => ids.map((id) => album({ id, title: `Album ${id}` }));
    const grid = (...ids: number[]): MusicSection[] => [{ kind: 'albums', albums: albums(...ids), hideArtist: false }];

    it('puts focus back on the same album, in the lane it moved to', () => {
      const { rerender } = render(<MusicList label="Albums" memoryKey="albums" sections={grid(1, 2, 3, 4)} />);
      act(() => screen.getByRole('list', { name: 'Albums' }).focus());
      fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowRight' });
      const card = screen.getByText('Album 2').closest('button');
      expect(document.activeElement).toBe(card);

      // Two lanes here, so a new album first pushes this one to the start of the next.
      rerender(<MusicList label="Albums" memoryKey="albums" sections={grid(9, 1, 2, 3, 4)} />);

      expect(card?.isConnected).toBe(false);
      expect(document.activeElement).toBe(screen.getByText('Album 2').closest('button'));
    });

    it('lets go when that album has gone', () => {
      const { rerender } = render(<MusicList label="Albums" memoryKey="albums" sections={grid(1, 2, 3, 4)} />);
      act(() => screen.getByRole('list', { name: 'Albums' }).focus());
      fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowRight' });

      rerender(<MusicList label="Albums" memoryKey="albums" sections={grid(1, 3, 4)} />);

      expect(document.activeElement).toBe(document.body);
    });

    it('does not take focus back from someone who has moved it away', () => {
      const { rerender } = render(
        <>
          <MusicList label="Albums" memoryKey="albums" sections={grid(1, 2, 3, 4)} />
        </>,
      );
      act(() => screen.getByRole('list', { name: 'Albums' }).focus());
      act(() => (document.activeElement as HTMLElement).blur());

      rerender(
        <>
          <MusicList label="Albums" memoryKey="albums" sections={grid(9, 1, 2, 3, 4)} />
        </>,
      );

      expect(document.activeElement).toBe(document.body);
    });
  });
});
