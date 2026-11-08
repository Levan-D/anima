/* Between a mood station's name keys and the method's rows: which songs an example names, and which a station plays. Pure. */

import { createHash } from 'node:crypto';
import type { ExampleKind, MoodGrade } from '@shared/stations';
import { decadeOf } from './radioStart';
import type { StationExample, StationGrade } from './stations';

export type MoodTrack = {
  id: number;
  /** Its row of the library's vectors, or -1 without a fingerprint. */
  row: number;
  isMissing: boolean;
  trackKey: string;
  albumKey: string | null;
  artistKey: string;
  mains: readonly string[];
  year: number | null;
  artHash: string | null;
};

export type KeyedExample = { kind: ExampleKind; key: string; isYes: boolean };
export type MoodFilter = { genre: string | null; decade: number | null };

/** The keys that name a track, as `kind\tkey`. */
function namesOf(track: MoodTrack): string[] {
  return [
    `track\t${track.trackKey}`,
    ...(track.albumKey === null ? [] : [`album\t${track.albumKey}`]),
    `artist\t${track.artistKey}`,
    ...track.mains.map((main) => `genre\t${main}`),
  ];
}

export type ResolvedExamples = {
  /** One for each example, in order, with no rows for one the library doesn't have now. */
  examples: StationExample[];
  /** The tracks each names, with a fingerprint or not. */
  trackIds: number[][];
};

export function resolveExamples(tracks: readonly MoodTrack[], examples: readonly KeyedExample[]): ResolvedExamples {
  const named = new Map<string, MoodTrack[]>();
  for (const track of tracks) {
    for (const name of namesOf(track)) {
      const list = named.get(name) ?? [];
      list.push(track);
      named.set(name, list);
    }
  }
  const matched = examples.map(({ kind, key }) => named.get(`${kind}\t${key}`) ?? []);
  return {
    examples: examples.map(({ kind, isYes }, index) => ({
      isYes,
      isSingle: kind === 'track',
      rows: (matched[index] ?? []).flatMap(({ row }) => (row >= 0 ? [row] : [])),
    })),
    trackIds: matched.map((list) => list.map(({ id }) => id)),
  };
}

/**
 * What a fit learned from, so a kept model is used only while it still holds: the fingerprint model and each example's
 * songs, by track id. New songs elsewhere in the library don't count: they shift the background a little, not the station.
 */
export function fitKey(fingerprintModel: string, { examples, trackIds }: ResolvedExamples): string {
  const parts = examples.map(({ isYes, isSingle }, index) => {
    const ids = (trackIds[index] ?? []).toSorted((a, b) => a - b).join(',');
    return `${isYes ? 'y' : 'n'}${isSingle ? 's' : 'g'}:${ids}`;
  });
  return createHash('sha256')
    .update(`${fingerprintModel}|${parts.join(';')}`)
    .digest('hex');
}

/** Tracks by row of the vectors. */
export function tracksByRow(tracks: readonly MoodTrack[], rows: number): (MoodTrack | null)[] {
  const byRow = Array.from<MoodTrack | null>({ length: rows }).fill(null);
  for (const track of tracks) if (track.row >= 0 && track.row < rows) byRow[track.row] = track;
  return byRow;
}

export function passesFilter({ mains, year }: MoodTrack, { genre, decade }: MoodFilter): boolean {
  return (genre === null || mains.includes(genre)) && (decade === null || decadeOf(year) === decade);
}

/** What a station's rows play: those on this device, with its filter. */
export function playableTracks(
  byRow: readonly (MoodTrack | null)[],
  rows: readonly number[],
  filter: MoodFilter,
): MoodTrack[] {
  return rows.flatMap((row) => {
    const track = byRow[row];
    return track === null || track === undefined || track.isMissing || !passesFilter(track, filter) ? [] : [track];
  });
}

/** How many songs each genre filter would leave, and each decade filter, with the other filter as it is. */
export function filterCounts(
  byRow: readonly (MoodTrack | null)[],
  rows: readonly number[],
  filter: MoodFilter,
): { genres: { name: string; songs: number }[]; decades: { decade: number; songs: number }[] } {
  const genres = new Map<string, number>();
  const decades = new Map<number, number>();
  for (const track of playableTracks(byRow, rows, { genre: null, decade: filter.decade })) {
    for (const main of track.mains) genres.set(main, (genres.get(main) ?? 0) + 1);
  }
  for (const track of playableTracks(byRow, rows, { genre: filter.genre, decade: null })) {
    const decade = decadeOf(track.year);
    if (decade !== null) decades.set(decade, (decades.get(decade) ?? 0) + 1);
  }
  return {
    genres: [...genres]
      .map(([name, songs]) => ({ name, songs }))
      .toSorted((a, b) => b.songs - a.songs || a.name.localeCompare(b.name)),
    decades: [...decades].map(([decade, songs]) => ({ decade, songs })).toSorted((a, b) => a.decade - b.decade),
  };
}

/** A check round asks about one song from an album, or from an artist's loose songs. */
export function checkKeyOf(track: MoodTrack | null): string {
  if (track === null) return '';
  return track.albumKey === null ? `artist\t${track.artistKey}` : `album\t${track.albumKey}`;
}

export function gradeView(grade: StationGrade): MoodGrade {
  return {
    kind: grade.kind,
    examples: grade.heldOut.map(({ example, median, isRight }) => ({ index: example, median, isRight })),
    alike: grade.kind === 'alike' ? grade.alike : [],
  };
}
