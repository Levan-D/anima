import { describe, expect, it } from 'vitest';
import { albumGroups } from '@/features/Library/utils/albumGroups';
import { track } from '@/lib/testing';

describe('albumGroups', () => {
  it('puts each run of one album under a heading like foobar2000', () => {
    const one = track({ id: 1, albumId: 7, album: 'Megalithic Symphony', albumArtist: 'AWOLNATION', year: 2011 });
    const two = track({ id: 2, albumId: 7, album: 'Megalithic Symphony', albumArtist: 'AWOLNATION', year: 2011 });
    const three = track({ id: 3, albumId: 8, album: 'Run', albumArtist: 'AWOLNATION', year: 2015 });
    expect(albumGroups([one, two, three])).toEqual([
      { kind: 'albumGroup', heading: 'AWOLNATION - Megalithic Symphony', tracks: [one, two] },
      { kind: 'albumGroup', heading: 'AWOLNATION - Run', tracks: [three] },
    ]);
  });

  it('uses the artist when there is no album artist', () => {
    const solo = track({ id: 1, albumId: 3, album: 'Demos', albumArtist: null, artist: 'Einaudi', year: null });
    expect(albumGroups([solo])[0]).toMatchObject({ heading: 'Einaudi - Demos' });
  });

  it('groups tracks with no album under their artist', () => {
    const a = track({ id: 1, albumId: null, album: null, artistId: 4, artist: 'Jim Brickman', albumArtist: null });
    const b = track({ id: 2, albumId: null, album: null, artistId: 4, artist: 'Jim Brickman', albumArtist: null });
    const c = track({ id: 3, albumId: null, album: null, artistId: 5, artist: 'Mozart', albumArtist: null });
    expect(albumGroups([a, b, c]).map((group) => group.kind === 'albumGroup' && group.heading)).toEqual([
      'Jim Brickman',
      'Mozart',
    ]);
  });

  it('has nothing for no tracks', () => {
    expect(albumGroups([])).toEqual([]);
  });
});
