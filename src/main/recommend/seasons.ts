/* Which themes count right now, and what that does to a song. Pure: the date comes in from main at each ask. */

import { isInWindow, monthDayOf, THEME_IDS, type Seasons, type ThemeId } from '@shared/themes';

export type SeasonAsk = {
  themes: readonly { id: ThemeId; boost: number; isInSeason: boolean }[];
  stay: number;
  /** What this run was started from or asked about, whose themes count as in season whatever the date. */
  asked: readonly number[];
};

/** Null with the switch off, and then the engine takes the path it had before themes. */
export function seasonAsk({ isOn, stay, themes }: Seasons, today: Date, asked: readonly number[]): SeasonAsk | null {
  if (!isOn) return null;
  const date = monthDayOf(today);
  return {
    asked,
    stay,
    themes: THEME_IDS.map((id) => {
      const { from, to, boost } = themes[id];
      return { id, boost, isInSeason: isInWindow(date, from, to) };
    }),
  };
}

/** The bonus a song of this theme gets in this run, or null if it's hidden. */
export type ThemeBonus = (theme: ThemeId | null) => number | null;

/**
 * How far below the floor a song may start. Only what a run was asked for: a Dollyrots Christmas song sounds nothing like
 * Pink Martini's, and they're still what someone starting from it wants. A date alone never gets anything past the floor.
 */
export function floorLift(season: SeasonAsk | null, askedThemes: readonly (ThemeId | null)[]) {
  const wanted = new Set(askedThemes);
  return (theme: ThemeId | null): number => (season !== null && theme !== null && wanted.has(theme) ? season.stay : 0);
}

/**
 * A fifth, so any one of radio's last five counts, and one stray song in a long playlist doesn't. Playing one doesn't make
 * it what the run is for: only what was asked for gets the extra, or one pick would carry a rock station into Christmas.
 */
const SEED_SHARE = 0.2;

export function themeBonus(
  season: SeasonAsk | null,
  seedThemes: readonly (ThemeId | null)[],
  askedThemes: readonly (ThemeId | null)[],
): ThemeBonus {
  if (season === null) return () => 0;
  const counts = new Map<ThemeId, number>();
  for (const theme of seedThemes) if (theme !== null) counts.set(theme, (counts.get(theme) ?? 0) + 1);
  const wanted = new Set(askedThemes);
  const lifted = new Set(wanted);
  for (const [theme, count] of counts) if (count / seedThemes.length >= SEED_SHARE) lifted.add(theme);

  const rules = new Map(season.themes.map((rule) => [rule.id, rule]));
  return (theme) => {
    if (theme === null) return 0;
    const rule = rules.get(theme);
    if (rule === undefined) return 0;
    if (wanted.has(theme)) return rule.boost + season.stay;
    return rule.isInSeason || lifted.has(theme) ? rule.boost : null;
  };
}
