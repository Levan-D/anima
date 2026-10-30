import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AlbumArt } from '@/components/music/AlbumArt';
import { titleHue } from '@/lib/artFallback';

const HASH = 'a'.repeat(40);

describe('AlbumArt', () => {
  it('asks for the thumbnail, lazily and off the main thread', () => {
    const { container } = render(<AlbumArt hash={HASH} title="Homogenic" />);
    const image = container.querySelector('img');
    expect(image?.getAttribute('src')).toBe(`art://thumb/${HASH}`);
    expect(image?.getAttribute('loading')).toBe('lazy');
    expect(image?.getAttribute('decoding')).toBe('async');
    expect(image?.getAttribute('alt')).toBe('');
  });

  it('with no art, sets the title on a sleeve instead of showing a broken image', () => {
    const { container } = render(<AlbumArt hash={null} title="Homogenic" />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('Homogenic')).toBeTruthy();
    expect(container.querySelector('.art-fallback')).toBeTruthy();
  });

  it('falls back the same way when the image fails to load', () => {
    const { container } = render(<AlbumArt hash={HASH} title="Homogenic" />);
    fireEvent.error(container.querySelector('img') as Element);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('Homogenic')).toBeTruthy();
  });

  it('tries again when it is given different art', () => {
    const { container, rerender } = render(<AlbumArt hash={HASH} title="Homogenic" />);
    fireEvent.error(container.querySelector('img') as Element);

    rerender(<AlbumArt hash={'b'.repeat(40)} title="Homogenic" />);

    expect(container.querySelector('img')?.getAttribute('src')).toBe(`art://thumb/${'b'.repeat(40)}`);
  });
});

describe('titleHue', () => {
  it('always gives the same album the same sleeve', () => {
    expect(titleHue('Homogenic')).toBe(titleHue('Homogenic'));
  });

  it('gives a valid hue for anything, and different ones for different titles', () => {
    for (const title of ['', 'Homogenic', '東京事変', 'Звери', '🎵'.repeat(50)]) {
      const hue = titleHue(title);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
    expect(titleHue('Homogenic')).not.toBe(titleHue('Vespertine'));
  });
});
