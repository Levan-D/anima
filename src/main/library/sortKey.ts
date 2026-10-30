// Letters NFD can't take apart, so they'd otherwise sort after z.
const BASE_LETTERS: Record<string, string> = {
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ł: 'l',
  ı: 'i',
};

function withoutDiacritics(text: string): string {
  return text.toLowerCase().normalize('NFD').replaceAll(/\p{M}/gu, '');
}

function flattened(text: string): string {
  return withoutDiacritics(text).replaceAll(/[ßæœøđðþłı]/g, (letter) => BASE_LETTERS[letter] ?? letter);
}

/** Lowercase, no diacritics, and a leading "the " moved to the end. */
export function sortKey(text: string): string {
  const plain = flattened(text).trim();
  return plain.startsWith('the ') ? `${plain.slice(4)}, the` : plain;
}

/**
 * What goes in a search column. The tokenizer folds Björk to bjork on its own, but splits AC/DC and
 * R.E.M. at their punctuation and leaves ø alone, so this adds how they'd be typed: acdc, rem, chloe.
 */
export function searchText(text: string): string {
  const typed = flattened(text).replaceAll(/[^\p{L}\p{N}\s]/gu, '');
  return typed === withoutDiacritics(text) ? text : `${text} ${typed}`;
}
