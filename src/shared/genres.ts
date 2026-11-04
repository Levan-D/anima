const SUB_GENRE = /^(.+?) \((.+)\)$/;

/** `Rock (Classic)` is Rock's Classic. A genre with no brackets is a main genre with no sub genre. */
export function mainGenreOf(genre: string): string {
  return SUB_GENRE.exec(genre)?.[1] ?? genre;
}

/** The genres one tag puts a track in: `Pop (Electro)` is in Pop, and in Electro as its sibling. */
export function genreFamily(genre: string): string[] {
  const parts = SUB_GENRE.exec(genre);
  return parts?.[1] === undefined || parts[2] === undefined ? [genre] : [parts[1], parts[2]];
}
