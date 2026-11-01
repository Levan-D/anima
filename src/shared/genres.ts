const SUB_GENRE = /^(.+?) \((.+)\)$/;

/** `Rock (Classic)` is Rock's Classic. A genre with no brackets is a main genre with no sub genre. */
export function mainGenreOf(genre: string): string {
  return SUB_GENRE.exec(genre)?.[1] ?? genre;
}
