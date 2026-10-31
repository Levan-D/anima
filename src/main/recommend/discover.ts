/* Who listeners of what's owned also listen to, among what isn't owned. Pure, over the rows as they're stored. */

import type { DiscoverArtist } from '@shared/domain';

const MAX_ARTISTS = 200;
const MAX_TRACKS = 5;
/** The tail of an answer is barely connected, and shouldn't count as someone recommending it. */
const MIN_SCORE = 0.05;

export type ArtistLinkRow = {
  sourceKey: string;
  sourceName: string;
  targetKey: string;
  targetName: string;
  score: number;
};
export type TrackLinkRow = { targetArtistKey: string; targetTitleKey: string; targetTitle: string; score: number };

export function discoverArtists(
  artistLinks: readonly ArtistLinkRow[],
  trackLinks: readonly TrackLinkRow[],
  ownedArtists: ReadonlySet<string>,
): DiscoverArtist[] {
  const byArtist = new Map<string, { name: string; score: number; recommenders: Map<string, number> }>();
  for (const { sourceKey, sourceName, targetKey, targetName, score } of artistLinks) {
    if (score < MIN_SCORE || ownedArtists.has(targetKey) || !ownedArtists.has(sourceKey)) continue;
    const entry = byArtist.get(targetKey) ?? { name: targetName, score: 0, recommenders: new Map() };
    entry.score += score;
    entry.recommenders.set(sourceName, score);
    byArtist.set(targetKey, entry);
  }

  const tracksByArtist = new Map<string, Map<string, { title: string; score: number }>>();
  for (const { targetArtistKey, targetTitleKey, targetTitle, score } of trackLinks) {
    if (!byArtist.has(targetArtistKey)) continue;
    const songs = tracksByArtist.get(targetArtistKey) ?? new Map<string, { title: string; score: number }>();
    const song = songs.get(targetTitleKey) ?? { title: targetTitle, score: 0 };
    song.score += score;
    songs.set(targetTitleKey, song);
    tracksByArtist.set(targetArtistKey, songs);
  }

  return [...byArtist]
    .map(([key, { name, score, recommenders }]) => ({
      key,
      name,
      score,
      recommendedBy: [...recommenders].toSorted((a, b) => b[1] - a[1]).map(([recommender]) => recommender),
      tracks: [...(tracksByArtist.get(key)?.values() ?? [])]
        .toSorted((a, b) => b.score - a.score)
        .slice(0, MAX_TRACKS)
        .map(({ title }) => title),
    }))
    .toSorted(
      (a, b) =>
        b.recommendedBy.length - a.recommendedBy.length || b.score - a.score || a.name.localeCompare(b.name, 'en'),
    )
    .slice(0, MAX_ARTISTS)
    .map(({ key, name, recommendedBy, tracks }) => ({ key, name, recommendedBy, tracks }));
}
