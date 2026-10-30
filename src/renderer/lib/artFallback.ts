/** A stable hue for a title, so an album with no art always gets the same sleeve. */
export function titleHue(title: string): number {
  let hash = 0;
  for (const character of title) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  return hash % 360;
}
