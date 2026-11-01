/* Who listeners of what's owned also listen to, among what isn't owned. Pure, over the rows as they're stored. */

import type { DiscoverArtist, DiscoverDetail, DiscoverGenre, DiscoverList } from '@shared/domain';
import { MIN_RECOMMENDER_SCORE } from '@shared/recommenderScore';
import { songKey } from './engine';

/** Enough that a small genre still has a page of its own, and the long tail doesn't all cross IPC. */
const MAX_ARTISTS = 2_000;
const MAX_TRACKS = 5;
const MAX_RECOMMENDERS_SENT = 6;
const MAX_GENRES = 2;
/** A second genre has to be a real part of the picture, not whatever one recommender also dabbles in. */
const SECOND_GENRE_SHARE = 0.4;

export type ArtistLinkRow = {
  sourceKey: string;
  sourceName: string;
  targetKey: string;
  targetName: string;
  score: number;
};
export type TrackLinkRow = { targetArtistKey: string; targetTitleKey: string; targetTitle: string; score: number };

/** What an owned artist brings to a suggestion: a sleeve to show, and what its tracks are tagged as, as shares of 1. */
export type ArtistProfile = { artHash: string | null; genres: ReadonlyMap<string, number> };
export type ArtistGenreRow = { artistKey: string; genre: string; tracks: number };
/** Biggest album first, so the first one for an artist is the one to show. */
export type ArtistArtRow = { artistKey: string; artHash: string };

export function artistProfiles(
  genreRows: readonly ArtistGenreRow[],
  artRows: readonly ArtistArtRow[],
): Map<string, ArtistProfile> {
  const counts = new Map<string, Map<string, number>>();
  for (const { artistKey, genre, tracks } of genreRows) {
    const genres = counts.get(artistKey) ?? new Map<string, number>();
    genres.set(genre, (genres.get(genre) ?? 0) + tracks);
    counts.set(artistKey, genres);
  }

  const art = new Map<string, string>();
  for (const { artistKey, artHash } of artRows) if (!art.has(artistKey)) art.set(artistKey, artHash);

  const profiles = new Map<string, ArtistProfile>();
  for (const key of new Set([...counts.keys(), ...art.keys()])) {
    const genres = counts.get(key) ?? new Map<string, number>();
    const total = [...genres.values()].reduce((sum, tracks) => sum + tracks, 0);
    profiles.set(key, {
      artHash: art.get(key) ?? null,
      genres: new Map([...genres].map(([genre, tracks]) => [genre, tracks / total])),
    });
  }
  return profiles;
}

/**
 * A suggestion has no genre of its own, so it takes those of who recommends it: each recommender's genres, as shares of
 * its tracks, counted by how strongly it recommends. Ties go by name, so a refresh doesn't shuffle them.
 */
export function inferGenres(recommenders: readonly { score: number; genres: ReadonlyMap<string, number> }[]): string[] {
  const totals = new Map<string, number>();
  for (const { score, genres } of recommenders) {
    for (const [genre, share] of genres) totals.set(genre, (totals.get(genre) ?? 0) + score * share);
  }
  const ranked = [...totals].toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en'));
  const best = ranked[0]?.[1] ?? 0;
  return ranked
    .slice(0, MAX_GENRES)
    .filter(([, weight]) => weight >= best * SECOND_GENRE_SHARE)
    .map(([genre]) => genre);
}

type Recommender = { key: string; name: string; score: number };

export function discoverArtists(
  artistLinks: readonly ArtistLinkRow[],
  trackLinks: readonly TrackLinkRow[],
  ownedArtists: ReadonlySet<string>,
  profiles: ReadonlyMap<string, ArtistProfile> = new Map(),
): DiscoverArtist[] {
  const byArtist = new Map<string, { name: string; score: number; recommenders: Map<string, Recommender> }>();
  for (const { sourceKey, sourceName, targetKey, targetName, score } of artistLinks) {
    if (score < MIN_RECOMMENDER_SCORE || ownedArtists.has(targetKey) || !ownedArtists.has(sourceKey)) continue;
    const entry = byArtist.get(targetKey) ?? { name: targetName, score: 0, recommenders: new Map() };
    entry.score += score;
    entry.recommenders.set(sourceKey, { key: sourceKey, name: sourceName, score });
    byArtist.set(targetKey, entry);
  }

  const ranked = [...byArtist]
    .toSorted(
      ([, a], [, b]) =>
        b.recommenders.size - a.recommenders.size || b.score - a.score || a.name.localeCompare(b.name, 'en'),
    )
    .slice(0, MAX_ARTISTS);
  const shown = new Set(ranked.map(([key]) => key));

  const tracksByArtist = new Map<string, Map<string, { title: string; score: number }>>();
  for (const { targetArtistKey, targetTitleKey, targetTitle, score } of trackLinks) {
    if (!shown.has(targetArtistKey)) continue;
    const songs = tracksByArtist.get(targetArtistKey) ?? new Map<string, { title: string; score: number }>();
    const song = songs.get(targetTitleKey) ?? { title: targetTitle, score: 0 };
    song.score += score;
    songs.set(targetTitleKey, song);
    tracksByArtist.set(targetArtistKey, songs);
  }

  return ranked.map(([key, { name, recommenders }]) => {
    const closest = [...recommenders.values()].toSorted((a, b) => b.score - a.score);
    return {
      key,
      name,
      recommenderCount: closest.length,
      recommendedBy: closest.slice(0, MAX_RECOMMENDERS_SENT).map((recommender) => ({
        name: recommender.name,
        artHash: profiles.get(recommender.key)?.artHash ?? null,
      })),
      genres: inferGenres(
        closest.map(({ key: source, score }) => ({ score, genres: profiles.get(source)?.genres ?? new Map() })),
      ),
      tracks: [...(tracksByArtist.get(key)?.values() ?? [])]
        .toSorted((a, b) => b.score - a.score)
        .slice(0, MAX_TRACKS)
        .map(({ title }) => title),
    };
  });
}

/** The names of what led to it, which the list has no use for and which aren't held in memory. */
export type OwnedSong = { trackId: number; artistId: number };

export type TrackLeadRow = {
  sourceArtistKey: string;
  sourceTitleKey: string;
  sourceArtist: string;
  sourceTitle: string;
  targetTitleKey: string;
  targetTitle: string;
  score: number;
};

/** One suggestion in full. Who counts as recommending it is decided as it is for the list, so the two agree. */
export function discoverDetail(
  key: string,
  artistLinks: readonly ArtistLinkRow[],
  trackLeads: readonly TrackLeadRow[],
  ownedSongs: ReadonlyMap<string, OwnedSong>,
  ownedArtistIds: ReadonlyMap<string, number>,
  profiles: ReadonlyMap<string, ArtistProfile>,
): DiscoverDetail {
  const voices = new Map<string, DiscoverDetail['voices'][number]>();
  for (const { sourceKey, sourceName, targetKey, score } of artistLinks) {
    const artistId = ownedArtistIds.get(sourceKey);
    if (targetKey !== key || artistId === undefined || score < MIN_RECOMMENDER_SCORE) continue;
    if (score <= (voices.get(sourceKey)?.score ?? 0)) continue;
    voices.set(sourceKey, { artistId, name: sourceName, artHash: profiles.get(sourceKey)?.artHash ?? null, score });
  }

  type Lead = OwnedSong & { artist: string; title: string; score: number };
  const songs = new Map<string, { title: string; score: number; leads: Map<string, Lead> }>();
  for (const row of trackLeads) {
    const source = songKey(row.sourceArtistKey, row.sourceTitleKey);
    const owned = ownedSongs.get(source);
    if (owned === undefined) continue;
    const song = songs.get(row.targetTitleKey) ?? { title: row.targetTitle, score: 0, leads: new Map<string, Lead>() };
    song.score += row.score;
    if (row.score > (song.leads.get(source)?.score ?? 0)) {
      song.leads.set(source, { ...owned, artist: row.sourceArtist, title: row.sourceTitle, score: row.score });
    }
    songs.set(row.targetTitleKey, song);
  }

  return {
    voices: [...voices.values()].toSorted((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'en')),
    tracks: [...songs.values()]
      .toSorted((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'en'))
      .map(({ title, leads }) => ({
        title,
        ledBy: [...leads.values()]
          .toSorted((a, b) => b.score - a.score)
          .map(({ trackId, artistId, artist, title: from }) => ({ trackId, artistId, artist, title: from })),
      })),
  };
}

/** Most suggestions first. */
export function genresOf(artists: readonly DiscoverArtist[]): DiscoverGenre[] {
  const counts = new Map<string, number>();
  for (const { genres } of artists) for (const genre of genres) counts.set(genre, (counts.get(genre) ?? 0) + 1);
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .toSorted((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'en'));
}

export function discoverList(
  artistLinks: readonly ArtistLinkRow[],
  trackLinks: readonly TrackLinkRow[],
  ownedArtists: ReadonlySet<string>,
  profiles: ReadonlyMap<string, ArtistProfile>,
): DiscoverList {
  const artists = discoverArtists(artistLinks, trackLinks, ownedArtists, profiles);
  return { artists, genres: genresOf(artists), hasData: artistLinks.length > 0 };
}
