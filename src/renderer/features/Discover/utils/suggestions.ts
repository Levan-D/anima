import type { DiscoverArtist, DiscoverGenre, DiscoverRecommender } from '@shared/domain';
import { formatCount } from '@/lib/format';

const NAMES_SHOWN = 2;
const COVERS_SHOWN = 3;

function folded(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** In the order they came, so the ranking holds. The search looks at the name and at who recommends it. */
export function matching(
  artists: readonly DiscoverArtist[],
  selected: readonly string[],
  query = '',
): readonly DiscoverArtist[] {
  const wanted = new Set(selected);
  const text = folded(query.trim());
  if (wanted.size === 0 && text === '') return artists;
  return artists.filter(
    ({ name, genres, recommendedBy }) =>
      (wanted.size === 0 || genres.some((genre) => wanted.has(genre))) &&
      (text === '' ||
        [name, ...recommendedBy.map((by) => by.name)].some((candidate) => folded(candidate).includes(text))),
  );
}

const SUB_GENRE = /^(.+?) \((.+)\)$/;

/** `Rock (Classic)` is Rock's Classic. A genre with no brackets is a main genre with no sub genre. */
export function mainGenreOf(genre: string): string {
  return SUB_GENRE.exec(genre)?.[1] ?? genre;
}

function subGenreOf(genre: string): string | null {
  return SUB_GENRE.exec(genre)?.[2] ?? null;
}

/** Counted by artist rather than added up, since one artist can be in several sub genres of the same main one. */
export function mainGenrePills(artists: readonly DiscoverArtist[], mains: readonly string[]) {
  const counts = new Map<string, number>(mains.map((main) => [main, 0]));
  for (const { genres } of artists) {
    for (const main of new Set(genres.map(mainGenreOf))) counts.set(main, (counts.get(main) ?? 0) + 1);
  }
  return [...counts]
    .sort(([nameA, a], [nameB, b]) => b - a || nameA.localeCompare(nameB))
    .map(([name, count]) => ({ value: name, label: name, count }));
}

/** The sub genres of the main ones that are on. With two on, the label says whose is whose. */
export function subGenrePills(genres: readonly DiscoverGenre[], mains: readonly string[]) {
  const isOneMain = mains.length === 1;
  return genres.flatMap(({ name, count }) => {
    const sub = subGenreOf(name);
    if (sub === null || !mains.includes(mainGenreOf(name))) return [];
    return [{ value: name, label: isOneMain ? sub : name, count }];
  });
}

/** A main genre with none of its sub genres picked means all of it, plain and sub alike. */
export function wantedGenres(
  genres: readonly DiscoverGenre[],
  mains: readonly string[],
  subs: readonly string[],
): readonly string[] {
  return genres
    .map(({ name }) => name)
    .filter((name) => {
      const main = mainGenreOf(name);
      if (!mains.includes(main)) return false;
      const hasPicks = subs.some((sub) => mainGenreOf(sub) === main);
      return !hasPicks || subs.includes(name);
    });
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

/** A score is how close against the closest that artist's listeners go anywhere, which most of its links are far from. */
export function strengthWords(score: number): string {
  if (score >= 0.7) return 'Very strong';
  if (score >= 0.4) return 'Strong';
  if (score >= 0.2) return 'Moderate';
  return 'Slight';
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
