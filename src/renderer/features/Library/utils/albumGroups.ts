import type { Track } from '@shared/domain';
import type { MusicSection } from '@/components/music/listItems';

function groupKeyOf({ albumId, artistId }: Track): string {
  return albumId === null ? `artist-${artistId}` : `album-${albumId}`;
}

/** Like foobar2000's: "Artist - Album". Tracks with no album tag are grouped under their artist alone. */
function headingOf({ album, albumArtist, artist }: Track): string {
  const by = albumArtist ?? artist;
  return album === null ? by : `${by} - ${album}`;
}

/** The whole library as runs of one album each. The tracks arrive sorted by album artist, year, album, disc and number. */
export function albumGroups(tracks: readonly Track[]): MusicSection[] {
  const groups: Track[][] = [];
  let lastKey: string | null = null;
  for (const track of tracks) {
    const key = groupKeyOf(track);
    if (key === lastKey) groups.at(-1)?.push(track);
    else groups.push([track]);
    lastKey = key;
  }

  return groups.flatMap((group): MusicSection[] => {
    const [first] = group;
    return first === undefined ? [] : [{ kind: 'albumGroup', heading: headingOf(first), tracks: group }];
  });
}
