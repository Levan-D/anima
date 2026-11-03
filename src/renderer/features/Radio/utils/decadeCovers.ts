import type { AlbumSummary } from '@shared/domain';

const MOST_COVERS = 3;

/** The art of a decade's biggest albums, so its tile looks like what it'll play. */
export function decadeCovers(albums: readonly AlbumSummary[], decade: number): AlbumSummary[] {
  return albums
    .filter(({ year, artHash }) => artHash !== null && year !== null && Math.floor(year / 10) * 10 === decade)
    .toSorted((a, b) => b.trackCount - a.trackCount)
    .slice(0, MOST_COVERS);
}
