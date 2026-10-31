import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '@shared/domain';
import { NowPlaying } from '@/features/NowPlaying/NowPlaying';
import { titleHue } from '@/lib/artFallback';
import { setPlayerState } from '@/lib/playerStore';
import { playerStateWith, resetRendererState, track } from '@/lib/testing';

const HASH_A = 'a'.repeat(40);
const HASH_B = 'b'.repeat(40);

type Decode = { src: string; resolve: () => void; reject: () => void };

let decodes: Decode[] = [];

/** jsdom never loads an image, so this says when each one is ready. */
class ImageThatWaits {
  src = '';
  decode(): Promise<void> {
    return new Promise((resolve, reject) => {
      decodes.push({ src: this.src, resolve, reject: () => reject(new Error('Could not decode')) });
    });
  }
}

const playing = (overrides: Partial<Track> = {}) => playerStateWith({ status: 'playing', current: track(overrides) });

async function finish(decode: Decode | undefined, how: 'resolve' | 'reject' = 'resolve'): Promise<void> {
  await act(async () => {
    decode?.[how]();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function shownImages(container: HTMLElement): (string | null)[] {
  return [...container.querySelectorAll('img')].map((image) => image.getAttribute('src'));
}

beforeEach(() => {
  resetRendererState();
  decodes = [];
  vi.stubGlobal('Image', ImageThatWaits);
  document.documentElement.style.removeProperty('--dur-mid');
});

describe('NowPlaying', () => {
  it('with nothing played yet it is quiet: a surface and one small line', () => {
    const { container } = render(<NowPlaying />);
    const line = screen.getByText('Nothing playing');
    expect(line.className).toContain('text-meta');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('h1')).toBeNull();
  });

  it('asks for the full art, and only shows it once it has been decoded', async () => {
    setPlayerState(playing({ artHash: HASH_A }));
    const { container } = render(<NowPlaying />);

    expect(decodes.map(({ src }) => src)).toContain(`art://full/${HASH_A}`);
    expect(container.querySelector('img')).toBeNull();

    await finish(decodes.at(-1));

    expect(shownImages(container)).toEqual([`art://full/${HASH_A}`]);
    expect(container.querySelector('img')?.getAttribute('decoding')).toBe('sync');
  });

  it('never says nothing is playing while the art of what is playing is on its way', () => {
    setPlayerState(playing({ artHash: HASH_A }));
    render(<NowPlaying />);
    expect(screen.queryByText('Nothing playing')).toBeNull();
  });

  it('keeps the old art up until the new one is ready, then has both while it fades in over it', async () => {
    document.documentElement.style.setProperty('--dur-mid', '100ms');
    setPlayerState(playing({ artHash: HASH_A }));
    const { container } = render(<NowPlaying />);
    await finish(decodes.at(-1));

    act(() => setPlayerState(playing({ artHash: HASH_B, id: 2 })));
    expect(shownImages(container)).toEqual([`art://full/${HASH_A}`]);

    await finish(decodes.at(-1));
    expect(shownImages(container)).toEqual([`art://full/${HASH_A}`, `art://full/${HASH_B}`]);

    await waitFor(() => expect(shownImages(container)).toEqual([`art://full/${HASH_B}`]));
  });

  it('skipping past a track drops its art, even if it decodes after the next one', async () => {
    setPlayerState(playing({ artHash: HASH_A }));
    const { container } = render(<NowPlaying />);
    const first = decodes.at(-1);

    act(() => setPlayerState(playing({ artHash: HASH_B, id: 2 })));
    await finish(decodes.at(-1));
    await finish(first);

    await waitFor(() => expect(shownImages(container)).toEqual([`art://full/${HASH_B}`]));
  });

  it('art that can not be had gets the sleeve, never a broken image', async () => {
    setPlayerState(playing({ artHash: HASH_A, album: 'Homogenic' }));
    const { container } = render(<NowPlaying />);

    await finish(decodes.at(-1), 'reject');

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('Homogenic')).toBeTruthy();
  });

  it('no art gets a calm gradient from the title, with the album title set large', () => {
    setPlayerState(playing({ artHash: null, album: 'Bare Sleeve' }));
    const { container } = render(<NowPlaying />);

    const sleeve = container.querySelector('.art-fallback') as HTMLElement;
    expect(sleeve.style.getPropertyValue('--art-hue')).toBe(String(titleHue('Bare Sleeve')));
    expect(screen.getByText('Bare Sleeve').className).toContain('text-cover');
    expect(decodes).toEqual([]);
  });

  it('a track with no album names the sleeve after itself', () => {
    setPlayerState(playing({ artHash: null, album: null, title: 'A Single' }));
    render(<NowPlaying />);
    expect(screen.getByText('A Single')).toBeTruthy();
  });

  it('the next track of the same album does not fade at all', async () => {
    setPlayerState(playing({ artHash: HASH_A }));
    const { container } = render(<NowPlaying />);
    await finish(decodes.at(-1));
    const image = container.querySelector('img');

    act(() => setPlayerState(playing({ artHash: HASH_A, id: 2, title: 'Next one' })));

    expect(container.querySelector('img')).toBe(image);
    expect(shownImages(container)).toHaveLength(1);
  });

  it('the art stays when the queue ends', async () => {
    setPlayerState(playing({ artHash: HASH_A }));
    const { container } = render(<NowPlaying />);
    await finish(decodes.at(-1));

    act(() => setPlayerState(playerStateWith({ status: 'ended', current: track({ artHash: HASH_A }) })));

    expect(shownImages(container)).toEqual([`art://full/${HASH_A}`]);
  });

  it('goes quiet again when the queue is cleared', async () => {
    setPlayerState(playing({ artHash: HASH_A }));
    const { container } = render(<NowPlaying />);
    await finish(decodes.at(-1));

    act(() => setPlayerState(playerStateWith()));

    await waitFor(() => expect(container.querySelector('img')).toBeNull());
    expect(screen.getByText('Nothing playing')).toBeTruthy();
  });
});
