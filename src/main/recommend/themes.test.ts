import { describe, expect, it } from 'vitest';
import { albumMarkKey, resolveThemes, themeContents, trackMarkKey, type ThemeInput } from './themes';

let nextId = 1;

function song(title: string, albumId: number | null = null, albumTitle: string | null = null, genres: string[] = []): ThemeInput {
  return { id: nextId++, title, artist: 'Someone', albumId, albumTitle, albumArtist: albumId === null ? null : 'Someone', genres };
}

function themeOf(input: ThemeInput, rest: ThemeInput[] = []) {
  return resolveThemes([input, ...rest], []).get(input.id)?.theme ?? null;
}

describe('detection', () => {
  it.each([
    ['Last Christmas', 'christmas'],
    ['Messed Up Xmas', 'christmas'],
    ['I Saw Mommy Biting Santa Claus', 'christmas'],
    ['Silent Night', 'christmas'],
    ['Noël blanc', 'christmas'],
    ['Halloween Blues', 'halloween'],
    ['Monster Mash', 'halloween'],
  ])('finds %s', (title, theme) => {
    expect(themeOf(song(title))).toBe(theme);
  });

  it.each([
    'Gifts from the Holy Ghost',
    'In Winter',
    'Ghost',
    'Flick Of The Switch',
    'Witch',
    'Nightwish',
    'Thriller',
    'Ghostbusters',
    'White Winter Hymnal',
    'Holiday In My Head',
    'Roman Holiday',
    'Jingle',
    'Santa Monica',
    'Merry Go Round',
    'Haunted',
    'Snow',
    'Christmasy',
  ])('leaves %s alone', (title) => {
    expect(themeOf(song(title))).toBeNull();
  });

  it('goes by an album title, for every track on it', () => {
    const album = [song("Let's Turkey Trot", 10, 'A Dollyrots Christmas EP'), song('Other', 10, 'A Dollyrots Christmas EP')];
    expect(resolveThemes(album, []).size).toBe(2);
  });

  it('leaves an album called something weak alone', () => {
    expect(themeOf(song('River', 11, 'In Winter'))).toBeNull();
    expect(themeOf(song('Song', 12, 'Flick Of The Switch'))).toBeNull();
    expect(themeOf(song('Song', 13, 'Jingle'))).toBeNull();
  });

  it('takes a whole album when a third of it says so, with at least two', () => {
    const titles = ['Silent Night', 'White Christmas', 'Other', 'Another', 'More', 'Last'];
    const album = titles.map((title) => song(title, 20, 'Joy To The World'));
    expect(resolveThemes(album, []).size).toBe(6);
  });

  it('leaves the rest of an album with too few', () => {
    const one = ['The Christmas Song', 'A', 'B'].map((title) => song(title, 21, 'Assorted'));
    expect(resolveThemes(one, []).size).toBe(1);
    const thin = ['Silent Night', 'White Christmas', 'A', 'B', 'C', 'D', 'E'].map((title) => song(title, 22, 'Long'));
    expect(resolveThemes(thin, []).size).toBe(2);
  });

  it('goes by a genre tag, on its own word', () => {
    expect(themeOf(song('Anything', null, null, ['Christmas']))).toBe('christmas');
    expect(themeOf(song('Anything', null, null, ['Holiday']))).toBe('christmas');
    expect(themeOf(song('Anything', null, null, ['Halloween']))).toBe('halloween');
    expect(themeOf(song('Anything', null, null, ['Rock (Holidays)']))).toBeNull();
  });
});

describe('marks', () => {
  it('beat detection, and the narrowest wins', () => {
    const last = song('Last Christmas', 30, 'An Album');
    const other = song('Other', 30, 'An Album');
    const marks = [
      { kind: 'album' as const, key: albumMarkKey('An Album', 'Someone'), theme: 'halloween' },
      { kind: 'track' as const, key: trackMarkKey('Last Christmas', 'Someone'), theme: 'none' },
    ];
    const themes = resolveThemes([last, other], marks);
    expect(themes.get(last.id)).toBeUndefined();
    expect(themes.get(other.id)).toEqual({ theme: 'halloween', isAuto: false });
  });

  it('mark a whole artist, and a theme no longer known is no theme', () => {
    const track = song('Anything');
    expect(resolveThemes([track], [{ kind: 'artist', key: 'someone', theme: 'halloween' }]).get(track.id)).toEqual({
      theme: 'halloween',
      isAuto: false,
    });
    expect(resolveThemes([track], [{ kind: 'artist', key: 'someone', theme: 'arbor-day' }]).size).toBe(0);
  });
});

it('lists by album, under its theme', () => {
  const contents = themeContents([
    { ...song('Last Christmas', 40, 'Xmas'), theme: 'christmas', isAuto: true },
    { ...song('Santa Baby', 40, 'Xmas'), theme: 'christmas', isAuto: false },
    { ...song('Halloween'), theme: 'halloween', isAuto: true },
  ]);
  expect(contents.christmas).toHaveLength(1);
  expect(contents.christmas[0]?.tracks.map(({ isAuto }) => isAuto)).toEqual([true, false]);
  expect(contents.halloween[0]?.albumId).toBeNull();
});
