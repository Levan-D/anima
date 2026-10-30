import { describe, expect, it } from 'vitest';
import { albumSections } from '@/features/Library/utils/albumSections';
import { track } from '@/lib/testing';

describe('albumSections', () => {
  it('has no headings for one disc', () => {
    const tracks = [track({ id: 1, discNumber: 1 }), track({ id: 2, discNumber: 1 })];
    expect(albumSections(tracks)).toEqual([{ kind: 'tracks', tracks, numbered: true }]);
  });

  it('treats no disc number as one disc', () => {
    const tracks = [track({ id: 1, discNumber: null }), track({ id: 2, discNumber: null })];
    expect(albumSections(tracks)).toHaveLength(1);
  });

  it('a track with no number sits with disc 1', () => {
    const tracks = [track({ id: 1, discNumber: null }), track({ id: 2, discNumber: 1 })];
    expect(albumSections(tracks)).toHaveLength(1);
  });

  it('has a heading per disc when there is more than one, keeping the order', () => {
    const one = track({ id: 1, discNumber: 1 });
    const two = track({ id: 2, discNumber: 2 });
    const three = track({ id: 3, discNumber: 2 });
    expect(albumSections([one, two, three])).toEqual([
      { kind: 'label', text: 'Disc 1' },
      { kind: 'tracks', tracks: [one], numbered: true },
      { kind: 'label', text: 'Disc 2' },
      { kind: 'tracks', tracks: [two, three], numbered: true },
    ]);
  });
});
