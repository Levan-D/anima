type FtsQueries = {
  tracks: string;
  artists: string;
  albums: string;
};

// What FTS5's unicode61 tokenizer keeps as part of a word. Anything else is a separator to it.
const WORD_CHARACTER = /[\p{L}\p{N}\p{Co}]/u;
const CONTROL_CHARACTERS = /\p{Cc}/gu;

function term(token: string): string {
  return `"${token.replaceAll('"', '""')}"*`;
}

/**
 * Everything the person typed ends up inside quotes, so none of it can be FTS syntax. Null when
 * there's no word to look for. A track matches on any column. An artist needs every word in the
 * artist column. An album needs at least one word in its title, and the rest in its title or artist.
 */
export function ftsQueries(input: string): FtsQueries | null {
  const terms = input
    .replaceAll(CONTROL_CHARACTERS, ' ')
    .split(/\s+/)
    .filter((token) => WORD_CHARACTER.test(token))
    .map(term);
  if (terms.length === 0) return null;

  const all = terms.join(' AND ');
  return {
    tracks: all,
    artists: `artist : (${all})`,
    albums: `{album artist} : (${all}) AND album : (${terms.join(' OR ')})`,
  };
}
