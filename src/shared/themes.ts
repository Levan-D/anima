/*
 * Songs that belong to a time of year. No tag says this, so a theme is found by its strongest words, on whole words, and
 * by a genre tag. Another theme is one more entry here. Weak words such as winter, snow, ghost or witch stay out on purpose:
 * they match Nightwish and Ghostbusters long before they match anything seasonal.
 */

export type MonthDay = { month: number; day: number };

type ThemeEntry = {
  id: string;
  label: string;
  /** Matched against titles and album titles, whole words only, ignoring case and accents. */
  words: readonly string[];
  /** Matched against each genre tag the same way, so tagging in foobar works. */
  genres: readonly string[];
  from: MonthDay;
  to: MonthDay;
};

export const THEMES = [
  {
    id: 'christmas',
    label: 'Christmas',
    words: [
      'christmas',
      'xmas',
      'x-mas',
      'noel',
      'santa claus',
      'santa baby',
      'silent night',
      'jingle bells',
      'jingle bell rock',
      'deck the halls',
      'rudolph the red',
      'little drummer boy',
      'we three kings',
      'carol of the bells',
      'away in a manger',
      'come all ye faithful',
      'hark the herald',
      'feliz navidad',
      'winter wonderland',
      'sleigh ride',
      'let it snow',
      'frosty the snowman',
      'mistletoe',
      'yuletide',
    ],
    genres: ['christmas', 'xmas', 'holiday'],
    from: { month: 11, day: 15 },
    to: { month: 1, day: 6 },
  },
  {
    id: 'halloween',
    label: 'Halloween',
    words: ['halloween', 'monster mash'],
    genres: ['halloween'],
    from: { month: 10, day: 1 },
    to: { month: 10, day: 31 },
  },
] as const satisfies readonly ThemeEntry[];

export type ThemeId = (typeof THEMES)[number]['id'];

export const THEME_IDS = THEMES.map(({ id }) => id) as [ThemeId, ...ThemeId[]];

export type ThemeSeason = {
  from: MonthDay;
  to: MonthDay;
  /** Added to a song's score when it's in season. */
  boost: number;
};

export type Seasons = {
  isOn: boolean;
  /** Added on top for a run started from a song of that theme, so it stays with it. */
  stay: number;
  themes: Record<ThemeId, ThemeSeason>;
};

export const SEASON_BOOST_MAX = 0.3;
export const SEASON_BOOST_DEFAULT = 0.12;
export const SEASON_STAY_MAX = 0.8;
export const SEASON_STAY_DEFAULT = 0.6;

export const SEASONS_DEFAULT: Seasons = {
  isOn: true,
  stay: SEASON_STAY_DEFAULT,
  themes: Object.fromEntries(
    THEMES.map(({ id, from, to }) => [id, { from, to, boost: SEASON_BOOST_DEFAULT }]),
  ) as Record<ThemeId, ThemeSeason>,
};

/** February has 29, since a window shouldn't break every fourth year. */
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

export function daysInMonth(month: number): number {
  return DAYS_IN_MONTH[month - 1] ?? 31;
}

/** Both ends count. A window whose end comes before its start runs across New Year. */
export function isInWindow({ month, day }: MonthDay, from: MonthDay, to: MonthDay): boolean {
  const at = (date: MonthDay) => date.month * 100 + date.day;
  const today = month * 100 + day;
  if (at(from) <= at(to)) return today >= at(from) && today <= at(to);
  return today >= at(from) || today <= at(to);
}

/** On the local calendar, since Christmas Eve is when it is where you are. */
export function monthDayOf(date: Date): MonthDay {
  return { month: date.getMonth() + 1, day: date.getDate() };
}

/** What a person can say about a song, album or artist. Automatic takes back what they said before. */
export const THEME_MARKS = [...THEME_IDS, 'none', 'auto'] as const;
export type ThemeMark = (typeof THEME_MARKS)[number];

export type ThemedTrack = { trackId: number; title: string; artist: string; isAuto: boolean };
export type ThemedAlbum = {
  albumId: number | null;
  /** Null for songs on no album. */
  title: string | null;
  artist: string;
  tracks: ThemedTrack[];
};
export type ThemeContents = Record<ThemeId, ThemedAlbum[]>;
