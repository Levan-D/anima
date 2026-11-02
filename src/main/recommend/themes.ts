/* Which theme a song belongs to: what a person said first, then what its words and tags give away. Pure. */

import { THEME_IDS, THEMES, type ThemeContents, type ThemedAlbum, type ThemeId } from '@shared/themes';
import { artistKey, titleKey } from '@main/library/names';

export type ThemeInput = {
  id: number;
  title: string;
  artist: string;
  albumId: number | null;
  albumTitle: string | null;
  albumArtist: string | null;
  genres: readonly string[];
};

export type MarkKind = 'track' | 'album' | 'artist';
export type ThemeMarkRow = { kind: MarkKind; key: string; theme: string };

export type TrackTheme = { theme: ThemeId; isAuto: boolean };

/** Of an album's tracks, this share and this many have to say it for the whole album to count. */
const ALBUM_SHARE = 1 / 3;
const ALBUM_MIN_HITS = 2;

function folded(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '');
}

function wholeWords(words: readonly string[]): RegExp {
  const escaped = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${escaped.join('|')})(?![\\p{L}\\p{N}])`, 'iu');
}

const MATCHERS = THEMES.map(({ id, words, genres }) => ({
  id,
  words: wholeWords(words),
  genres: wholeWords(genres),
}));

function themeOfText(text: string | null, pick: 'words' | 'genres'): ThemeId | null {
  if (text === null) return null;
  const plain = folded(text);
  return MATCHERS.find((matcher) => matcher[pick].test(plain))?.id ?? null;
}

function ownTheme({ title, genres }: ThemeInput): ThemeId | null {
  return themeOfText(title, 'words') ?? genres.map((genre) => themeOfText(genre, 'genres')).find(Boolean) ?? null;
}

/** An album's own title settles it, and otherwise enough of its tracks do. */
function albumThemes(tracks: readonly ThemeInput[]): Map<number, ThemeId> {
  const albums = new Map<number, ThemeInput[]>();
  for (const track of tracks) {
    if (track.albumId === null) continue;
    const list = albums.get(track.albumId) ?? [];
    list.push(track);
    albums.set(track.albumId, list);
  }

  const themes = new Map<number, ThemeId>();
  for (const [albumId, list] of albums) {
    const named = themeOfText(list[0]?.albumTitle ?? null, 'words');
    if (named !== null) {
      themes.set(albumId, named);
      continue;
    }
    const hits = new Map<ThemeId, number>();
    for (const track of list) {
      const theme = ownTheme(track);
      if (theme !== null) hits.set(theme, (hits.get(theme) ?? 0) + 1);
    }
    for (const [theme, count] of hits) {
      if (count >= ALBUM_MIN_HITS && count / list.length >= ALBUM_SHARE) themes.set(albumId, theme);
    }
  }
  return themes;
}

export function trackMarkKey(title: string, artist: string): string {
  return `${artistKey(artist)}\t${titleKey(title)}`;
}

export function albumMarkKey(albumTitle: string, albumArtist: string): string {
  return `${artistKey(albumArtist)}\t${titleKey(albumTitle)}`;
}

const KNOWN_THEMES = new Set<string>(THEMES.map(({ id }) => id));

/** The narrowest thing a person said about it, or undefined if they said nothing. Null is "No theme". */
function markOn(track: ThemeInput, marks: ReadonlyMap<string, string>): ThemeId | null | undefined {
  const { title, artist, albumTitle, albumArtist } = track;
  const said =
    marks.get(`track\t${trackMarkKey(title, artist)}`) ??
    (albumTitle === null ? undefined : marks.get(`album\t${albumMarkKey(albumTitle, albumArtist ?? artist)}`)) ??
    marks.get(`artist\t${artistKey(artist)}`);
  if (said === undefined) return undefined;
  return KNOWN_THEMES.has(said) ? (said as ThemeId) : null;
}

/** Only the tracks with a theme. The album share is worked out over what's given, so give whole albums. */
export function resolveThemes(
  tracks: readonly ThemeInput[],
  markRows: readonly ThemeMarkRow[],
): Map<number, TrackTheme> {
  const marks = new Map(markRows.map(({ kind, key, theme }) => [`${kind}\t${key}`, theme]));
  const albums = albumThemes(tracks);
  const themes = new Map<number, TrackTheme>();
  for (const track of tracks) {
    const mark = markOn(track, marks);
    if (mark === null) continue;
    if (mark !== undefined) {
      themes.set(track.id, { theme: mark, isAuto: false });
      continue;
    }
    const found = ownTheme(track) ?? (track.albumId === null ? null : (albums.get(track.albumId) ?? null));
    if (found !== null) themes.set(track.id, { theme: found, isAuto: true });
  }
  return themes;
}

/** By artist, then album, with songs on no album gathered under their artist. */
export function themeContents(themed: readonly (ThemeInput & TrackTheme)[]): ThemeContents {
  const contents = Object.fromEntries(THEME_IDS.map((id) => [id, [] as ThemedAlbum[]])) as ThemeContents;
  const albums = new Map<string, ThemedAlbum>();
  for (const { id, title, artist, albumId, albumTitle, albumArtist, theme, isAuto } of themed) {
    const groupKey = `${theme}\t${albumId ?? `artist:${artist}`}`;
    let group = albums.get(groupKey);
    if (group === undefined) {
      group = { albumId, title: albumTitle, artist: albumArtist ?? artist, tracks: [] };
      albums.set(groupKey, group);
      contents[theme].push(group);
    }
    group.tracks.push({ trackId: id, title, artist, isAuto });
  }
  for (const id of THEME_IDS) {
    contents[id].sort((a, b) => a.artist.localeCompare(b.artist) || (a.title ?? '').localeCompare(b.title ?? ''));
  }
  return contents;
}
