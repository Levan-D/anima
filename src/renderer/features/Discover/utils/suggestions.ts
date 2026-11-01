import type { DiscoverArtist, DiscoverGenre, DiscoverRecommender } from '@shared/domain';
import { formatCount } from '@/lib/format';

const NAMES_SHOWN = 2;
const COVERS_SHOWN = 3;

/** In the order they came, so the ranking holds. */
export function matching(artists: readonly DiscoverArtist[], selected: readonly string[]): readonly DiscoverArtist[] {
  if (selected.length === 0) return artists;
  const wanted = new Set(selected);
  return artists.filter(({ genres }) => genres.some((genre) => wanted.has(genre)));
}

/** A pill that's on stays, even when a library change leaves it with nothing, or there'd be no way to turn it off. */
export function genrePills(genres: readonly DiscoverGenre[], selected: readonly string[]) {
  const known = new Set(genres.map(({ name }) => name));
  return [
    ...genres.map(({ name, count }) => ({ value: name, label: name, count })),
    ...selected.filter((name) => !known.has(name)).map((name) => ({ value: name, label: name, count: 0 })),
  ];
}

export function becauseWords({ recommendedBy }: DiscoverArtist): string {
  return `Because you like ${recommendedBy
    .slice(0, NAMES_SHOWN)
    .map(({ name }) => name)
    .join(', ')}`;
}

export function countWords({ recommenderCount }: DiscoverArtist): string {
  return `${formatCount(recommenderCount)} of your artists`;
}

/** Those with a sleeve first, closest first, and a plain one only when no one has any. */
export function coversOf(recommenders: readonly DiscoverRecommender[]): readonly DiscoverRecommender[] {
  const withArt = recommenders.filter(({ artHash }) => artHash !== null);
  return withArt.length > 0 ? withArt.slice(0, COVERS_SHOWN) : recommenders.slice(0, 1);
}

export type Lane = {
  key: string;
  suggestions: readonly DiscoverArtist[];
};

export function toLanes(artists: readonly DiscoverArtist[], perLane: number): Lane[] {
  const lanes: Lane[] = [];
  for (let start = 0; start < artists.length; start += perLane) {
    const suggestions = artists.slice(start, start + perLane);
    lanes.push({ key: suggestions[0]?.key ?? String(start), suggestions });
  }
  return lanes;
}
