import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Connection } from '@main/db/connection';
import type { LibraryQueries } from '@main/library/queries';
import { closeTestDatabase, openTestDatabase, tempDir } from '@main/library/testFixtures';
import type { AlbumSummary, ArtistSummary, Track } from '@shared/domain';
import { err, ok, type Result } from '@shared/result';
import type { MoodDraft, MoodGrade } from '@shared/stations';
import { moodQueries } from './moodStore';
import { moodStationHandlers } from './moodStations';
import { albumMarkKey, trackMarkKey } from './themes';
import type { MoodAsk, TryAnswer } from './moodWork';
import type { MoodFit } from './moodStore';

const GRADE: MoodGrade = { kind: 'clear', examples: [], alike: [] };
const FIT: MoodFit = { model: Float64Array.from([1, 2]), modelOf: 'key', grade: GRADE };

function trackOf(id: number): Track {
  return { id, title: `Song ${id}`, artist: 'Ólafur Arnalds', artHash: null } as Track;
}

const ARTIST = { id: 1, name: 'The Cinematic Orchestra', trackCount: 40, artHash: 'a' } as ArtistSummary;
const ALBUM = { id: 2, title: 'Re:member', artist: 'Ólafur Arnalds', artHash: 'b' } as AlbumSummary;

/** Only what the handlers read. */
const QUERIES = {
  search: () => ({ artists: [ARTIST], albums: [ALBUM], tracks: [trackOf(3)], more: {} }),
  genres: () => [
    { id: 1, name: 'Jazz', trackCount: 30 },
    { id: 2, name: 'Jazz (Nu Jazz)', trackCount: 12 },
    { id: 3, name: 'Rock', trackCount: 90 },
  ],
} as unknown as LibraryQueries;

let db: Connection;
let events: { event: string; payload: unknown }[];
let answers: { tried: Result<TryAnswer>; graded: Result<MoodGrade | null>; fitted: Result<MoodFit | null> };
let asked: MoodAsk[];

function handlers() {
  return moodStationHandlers({
    library: {
      perConnection: (create) => (work) => ok(work(create(db))),
      read: (work) => ok(work(QUERIES)),
      tracksByIds: (ids) => ok(ids.map(trackOf)),
    },
    recommender: {
      moodTry: (ask) => {
        asked.push(ask);
        return Promise.resolve(answers.tried);
      },
      moodGrade: (_ask, onProgress) => {
        onProgress(1, 2);
        onProgress(2, 2);
        return Promise.resolve(answers.graded);
      },
      moodFit: () => Promise.resolve(answers.fitted),
      moodCards: () => Promise.resolve(ok([])),
    },
    emit: (event, payload) => events.push({ event, payload }),
    now: () => 5,
  });
}

const DRAFT: MoodDraft = {
  name: 'Evening',
  examples: [
    { kind: 'artist', key: 'cinematic orchestra', label: 'The Cinematic Orchestra', isYes: true, source: 'picked' },
  ],
  rules: { instrumental: false, calm: true, littleSinging: false },
  genre: null,
  decade: null,
};

beforeEach(() => {
  ({ db } = openTestDatabase(tempDir('mood-handlers')));
  events = [];
  asked = [];
  answers = { tried: ok({ problem: 'no-yes' }), graded: ok(GRADE), fitted: ok(FIT) };
});

afterEach(() => closeTestDatabase(db));

describe('mood station commands', () => {
  it('finds main genres, artists, albums and songs, each with the key it goes by', () => {
    const found = handlers()['moods.search']({ text: 'jazz' });
    expect(found).toEqual(
      ok([
        { kind: 'genre', key: 'Jazz', label: 'Jazz', by: null, songs: 42, artHash: null },
        {
          kind: 'artist',
          key: 'cinematic orchestra',
          label: 'The Cinematic Orchestra',
          by: null,
          songs: 40,
          artHash: 'a',
        },
        {
          kind: 'album',
          key: albumMarkKey('Re:member', 'Ólafur Arnalds'),
          label: 'Re:member – Ólafur Arnalds',
          by: 'Ólafur Arnalds',
          songs: null,
          artHash: 'b',
        },
        {
          kind: 'track',
          key: trackMarkKey('Song 3', 'Ólafur Arnalds'),
          label: 'Song 3 – Ólafur Arnalds',
          by: 'Ólafur Arnalds',
          songs: null,
          artHash: null,
        },
      ]),
    );
  });

  it('hands back the songs to check with the key each would go by', async () => {
    answers.tried = ok({
      problem: null,
      songs: 80,
      checkIds: [7, 8],
      rules: { instrumental: 'ready', calm: 'ready', littleSinging: 'unavailable' },
      genres: [],
      decades: [],
      grade: null,
    });
    const tried = await handlers()['moods.try']({ stationId: null, draft: DRAFT, skipped: [3] });
    if (!tried.ok || tried.value.problem !== null) throw new Error('no try');
    expect(tried.value.check.map(({ track, key }) => [track.id, key])).toEqual([
      [7, trackMarkKey('Song 7', 'Ólafur Arnalds')],
      [8, trackMarkKey('Song 8', 'Ólafur Arnalds')],
    ]);
    expect(tried.value).not.toHaveProperty('checkIds');
    expect(asked).toEqual([{ stationId: null, draft: DRAFT }]);
  });

  it('says superseded when a newer draft took over a try or a grade', async () => {
    answers.tried = ok({ problem: 'superseded' });
    answers.graded = ok(null);
    expect(await handlers()['moods.try']({ stationId: null, draft: DRAFT, skipped: [] })).toMatchObject({
      ok: false,
      error: { code: 'superseded' },
    });
    expect(await handlers()['moods.grade']({ stationId: null, draft: DRAFT })).toMatchObject({
      ok: false,
      error: { code: 'superseded' },
    });
  });

  it('tells the windows how far a grade has got', async () => {
    expect(await handlers()['moods.grade']({ stationId: null, draft: DRAFT })).toEqual(ok(GRADE));
    expect(events).toEqual([
      { event: 'moods.grading', payload: { done: 1, total: 2 } },
      { event: 'moods.grading', payload: { done: 2, total: 2 } },
    ]);
  });

  it('saves a new station with its model, edits it, and deletes it, telling the windows each time', async () => {
    const commands = handlers();
    const created = await commands['moods.save']({ stationId: null, draft: DRAFT });
    if (!created.ok) throw new Error(created.error.message);
    const { stationId } = created.value;
    expect(moodQueries(db).get(stationId)).toMatchObject({ name: 'Evening', modelOf: 'key', grade: GRADE });
    expect(commands['moods.get']({ stationId })).toEqual(ok({ ...DRAFT, id: stationId, grade: GRADE }));

    expect(await commands['moods.save']({ stationId, draft: { ...DRAFT, name: 'Late' } })).toEqual(ok({ stationId }));
    expect(moodQueries(db).get(stationId)?.name).toBe('Late');
    expect(commands['moods.delete']({ stationId })).toEqual(ok());
    expect(commands['moods.get']({ stationId })).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(events.filter(({ event }) => event === 'library.changed')).toHaveLength(3);
  });

  it('won’t save a station with nothing to learn from, or one that’s gone', async () => {
    const commands = handlers();
    answers.fitted = ok(null);
    expect(await commands['moods.save']({ stationId: null, draft: DRAFT })).toMatchObject({
      ok: false,
      error: { code: 'invalid_input' },
    });
    answers.fitted = ok(FIT);
    expect(await commands['moods.save']({ stationId: 99, draft: DRAFT })).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
    answers.fitted = err('unexpected', 'worker gone');
    expect(await commands['moods.save']({ stationId: null, draft: DRAFT })).toEqual(err('unexpected', 'worker gone'));
    expect(moodQueries(db).list()).toEqual([]);
  });
});
