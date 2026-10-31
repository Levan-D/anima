/* How names get compared wherever they come from outside: lyrics services, listener data, a dump. */

const LEADING_THE = /^the /;
const FEATURED = /\s+(?:feat|ft|featuring)\b.*$/;

export function normalizeName(name: string): string {
  const words = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  return words === '' ? name.trim() : words;
}

/** "Song (Remastered 2011)", "Song [Live]" and "Song - 2011 Remaster" are all "Song". */
export function baseTitle(title: string): string {
  const base = title
    .replace(/(\s*[([][^)\]]*[)\]])+\s*$/u, '')
    .replace(/\s+-\s+.*$/u, '')
    .trim();
  return base === '' ? title : base;
}

/** "The Beatles", "Beatles" and "Beatles feat. Billy Preston" are one artist to compare. */
export function artistKey(name: string): string {
  const key = normalizeName(name).replace(FEATURED, '').replace(LEADING_THE, '');
  return key === '' ? normalizeName(name) : key;
}

export function titleKey(title: string): string {
  return normalizeName(baseTitle(title)).replace(FEATURED, '');
}
