import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TrackRow } from '@/components/music/TrackRow';
import { track } from '@/lib/testing';

const NOOP = () => {};

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

  it('calls back with the track, and is a real button', () => {
    const onPlay = vi.fn();
    const song = track();
    render(<TrackRow track={song} onPlay={onPlay} />);

    fireEvent.click(screen.getByRole('button'));

    expect(onPlay).toHaveBeenCalledWith(song);
  });

  it('names the whole title for when the row cuts it off', () => {
    render(<TrackRow track={track({ title: 'A title far too long for any row' })} onPlay={NOOP} />);
    expect(screen.getByRole('button').getAttribute('title')).toBe('A title far too long for any row');
  });

  it('cuts right-to-left text from its end, not its beginning', () => {
    render(<TrackRow track={track({ title: 'אבג' })} onPlay={NOOP} />);
    expect(screen.getByText('אבג').getAttribute('dir')).toBe('auto');
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
