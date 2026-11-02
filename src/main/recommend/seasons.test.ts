import { describe, expect, it } from 'vitest';
import { isInWindow, SEASONS_DEFAULT, type Seasons } from '@shared/themes';
import { pickTracks, seededRandom, type EngineData, type EngineTrack, type RecommendRequest } from './engine';
import { resolveStart, type StartTrack } from './radioStart';
import { seasonAsk } from './seasons';

const NOV = { month: 11, day: 15 };
const JAN = { month: 1, day: 6 };

describe('isInWindow', () => {
  it.each([
    [{ month: 11, day: 14 }, false],
    [{ month: 11, day: 15 }, true],
    [{ month: 12, day: 31 }, true],
    [{ month: 1, day: 1 }, true],
    [{ month: 1, day: 6 }, true],
    [{ month: 1, day: 7 }, false],
    [{ month: 7, day: 15 }, false],
  ])('across New Year, %o is %s', (date, expected) => {
    expect(isInWindow(date, NOV, JAN)).toBe(expected);
  });

  it('within a year, both ends count', () => {
    const from = { month: 10, day: 1 };
    const to = { month: 10, day: 31 };
    expect(isInWindow({ month: 9, day: 30 }, from, to)).toBe(false);
    expect(isInWindow(from, from, to)).toBe(true);
    expect(isInWindow(to, from, to)).toBe(true);
    expect(isInWindow({ month: 11, day: 1 }, from, to)).toBe(false);
  });
});

function track(id: number, overrides: Partial<StartTrack> = {}): StartTrack {
  return {
    id,
    artistKey: `artist${id}`,
    titleKey: `title${id}`,
    genres: [],
    plays: 0,
    skips: 0,
    isMissing: false,
    vector: id - 1,
    theme: null,
    artistId: id,
    year: 2000,
    mains: ['Rock'],
    ...overrides,
  };
}

const JULY = new Date(2026, 6, 15);
const DECEMBER = new Date(2026, 11, 20);
const OFF: Seasons = { ...SEASONS_DEFAULT, isOn: false };

/** Everything sounds about the same, so what's picked comes down to the themes and the luck. */
function library(tracks: readonly StartTrack[]): EngineData {
  const dimensions = 2;
  const vectors = new Float32Array(tracks.length * dimensions);
  tracks.forEach((_, index) => {
    const angle = index * 0.01;
    vectors[index * dimensions] = Math.cos(angle);
    vectors[index * dimensions + 1] = Math.sin(angle);
  });
  return { tracks, vectors, dimensions, artistLinks: new Map(), trackLinks: new Map(), hubs: null, energy: null };
}

function ask(overrides: Partial<RecommendRequest> = {}): RecommendRequest {
  return {
    seeds: [1],
    exclude: [],
    recent: [],
    count: 10,
    maxPerArtist: 5,
    randomSeed: 3,
    wander: null,
    origin: null,
    energy: null,
    season: null,
    ...overrides,
  };
}

const TRACKS = [
  track(1),
  track(2),
  track(3),
  track(4, { theme: 'christmas' }),
  track(5, { theme: 'christmas' }),
  track(6, { theme: 'halloween' }),
];
const DATA = library(TRACKS);
const themeOf = (id: number): EngineTrack['theme'] => TRACKS.find((candidate) => candidate.id === id)?.theme ?? null;

describe('in the engine', () => {
  it('hides what is out of season', () => {
    const { trackIds } = pickTracks(DATA, ask({ season: seasonAsk(SEASONS_DEFAULT, JULY, []) }));
    expect(trackIds.map(themeOf)).toEqual([null, null]);
  });

  it('lets a theme in when a seed or what was asked for has it, and only that theme', () => {
    const fromSeed = pickTracks(DATA, ask({ seeds: [4], season: seasonAsk(SEASONS_DEFAULT, JULY, []) }));
    expect(fromSeed.trackIds.map(themeOf)).toContain('christmas');
    expect(fromSeed.trackIds.map(themeOf)).not.toContain('halloween');

    const fromAsked = pickTracks(DATA, ask({ season: seasonAsk(SEASONS_DEFAULT, JULY, [4]) }));
    expect(fromAsked.trackIds.map(themeOf)).toContain('christmas');
  });

  it('keeps one stray song in a long list of seeds from counting', () => {
    const many = Array.from({ length: 12 }, (_, index) => track(index + 10));
    const tracks = [...many, track(30, { theme: 'christmas' }), track(31, { theme: 'christmas' }), track(40)];
    const seeds = [...many.map(({ id }) => id), 30];
    const { trackIds } = pickTracks(library(tracks), ask({ seeds, season: seasonAsk(SEASONS_DEFAULT, JULY, []) }));
    expect(trackIds).not.toContain(31);
  });

  it('shows and boosts what is in season, ahead of what is otherwise the same', () => {
    const { trackIds } = pickTracks(DATA, ask({ season: seasonAsk(SEASONS_DEFAULT, DECEMBER, []) }));
    expect(trackIds.map(themeOf).slice(0, 2)).toEqual(['christmas', 'christmas']);
    expect(trackIds.map(themeOf)).not.toContain('halloween');
  });

  it('never lifts a song over the floor', () => {
    const boosted: Seasons = {
      ...SEASONS_DEFAULT,
      themes: { ...SEASONS_DEFAULT.themes, christmas: { ...SEASONS_DEFAULT.themes.christmas, boost: 0.3 } },
    };
    const far = library([track(1), track(2, { theme: 'christmas' })]);
    far.vectors.set([1, 0, -1, 0]);
    const { trackIds } = pickTracks(far, ask({ season: seasonAsk(boosted, DECEMBER, []) }));
    expect(trackIds).toEqual([]);
  });

  it('lets a run asked about a theme reach that theme below the floor, and nothing else', () => {
    const far = library([track(1, { theme: 'christmas' }), track(2, { theme: 'christmas' }), track(3)]);
    far.vectors.set([1, 0, -1, 0, -1, 0]);
    const { trackIds } = pickTracks(far, ask({ season: { ...seasonAsk(SEASONS_DEFAULT, JULY, [1])!, stay: 0.5 } }));
    expect(trackIds).toEqual([2]);
  });

  it('with the switch off, is the same as a library with no themes at all', () => {
    const plain = library(TRACKS.map((candidate) => ({ ...candidate, theme: null })));
    for (let randomSeed = 1; randomSeed <= 50; randomSeed++) {
      const request = ask({ randomSeed, season: seasonAsk(OFF, DECEMBER, []) });
      expect(pickTracks(DATA, request)).toEqual(pickTracks(plain, { ...request, season: null }));
    }
  });

  it('out of season, moves nothing but what it hides', () => {
    const season = seasonAsk(SEASONS_DEFAULT, JULY, []);
    for (let randomSeed = 1; randomSeed <= 50; randomSeed++) {
      const off = pickTracks(DATA, ask({ randomSeed })).trackIds.filter((id) => themeOf(id) === null);
      expect(pickTracks(DATA, ask({ randomSeed, season })).trackIds).toEqual(off);
    }
  });
});

describe('starting radio', () => {
  const start = (from: Parameters<typeof resolveStart>[2], date: Date, seasons = SEASONS_DEFAULT) =>
    resolveStart(DATA, TRACKS, from, {
      random: seededRandom(2),
      lastPlayed: new Map(),
      now: 1,
      season: seasonAsk(seasons, date, []),
    });

  it('a track asked for by name counts, whatever the date', () => {
    const outcome = start({ kind: 'track', trackId: 4 }, JULY);
    expect('problem' in outcome ? null : outcome.asked).toEqual([4]);
  });

  it('nothing else starts from what is out of season', () => {
    for (let randomSeed = 1; randomSeed <= 20; randomSeed++) {
      for (const from of [
        { kind: 'genre', genre: 'Rock' },
        { kind: 'decade', decade: 2000 },
        { kind: 'surprise', randomSeed },
        { kind: 'forgotten' },
      ] as const) {
        const outcome = resolveStart(DATA, TRACKS, from, {
          random: seededRandom(randomSeed),
          lastPlayed: new Map(),
          now: 1,
          season: seasonAsk(SEASONS_DEFAULT, JULY, []),
        });
        if ('problem' in outcome) throw new Error(outcome.problem);
        expect(outcome.seeds.map(themeOf)).not.toContain('christmas');
        expect(outcome.asked).toEqual([]);
      }
    }
  });

  it('a genre that is nothing but that theme is what was asked for', () => {
    const tracks = [track(1), track(2, { theme: 'christmas', mains: ['Carols'] })];
    const outcome = resolveStart(library(tracks), tracks, { kind: 'genre', genre: 'Carols' }, {
      random: seededRandom(2),
      lastPlayed: new Map(),
      now: 1,
      season: seasonAsk(SEASONS_DEFAULT, JULY, []),
    });
    expect('problem' in outcome ? null : outcome.asked).toEqual([2]);
  });

  it('a blend keeps out what it did not name', () => {
    const outcome = start(
      {
        kind: 'blend',
        parts: [
          { kind: 'track', id: 1 },
          { kind: 'track', id: 2 },
        ],
      },
      JULY,
    );
    expect('problem' in outcome ? [] : outcome.seeds.map(themeOf)).toEqual([null, null, null]);
  });
});
