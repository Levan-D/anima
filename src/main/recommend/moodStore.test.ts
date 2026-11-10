import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Connection } from '@main/db/connection';
import { closeTestDatabase, openTestDatabase, tempDir } from '@main/library/testFixtures';
import type { MoodDraft, MoodGrade } from '@shared/stations';
import { moodQueries, type MoodFit } from './moodStore';

let db: Connection;
let dbPath: string;

beforeEach(() => {
  ({ db, dbPath } = openTestDatabase(tempDir('mood-store')));
});

afterEach(() => closeTestDatabase(db));

const DRAFT: MoodDraft = {
  name: 'Study',
  examples: [
    { kind: 'artist', key: 'einaudi', label: 'Ludovico Einaudi', isYes: true, source: 'picked' },
    { kind: 'track', key: 'bach\tprelude', label: 'Prelude – Bach', isYes: false, source: 'check' },
    { kind: 'genre', key: 'Lo Fi', label: 'Lo Fi', isYes: true, source: 'listening' },
  ],
  rules: { instrumental: true, calm: false, littleSinging: true },
  genre: null,
  decade: 1990,
};
const GRADE: MoodGrade = { kind: 'clear', examples: [{ index: 0, median: 97.5, isRight: true }], alike: [] };
const FIT: MoodFit = { model: Float64Array.from([0.5, -1.25, 3]), modelOf: 'key-1', grade: GRADE };

describe('mood stations in the database', () => {
  it('keeps a station as it was given, examples in order, model and grade', () => {
    const queries = moodQueries(db);
    const id = queries.create(DRAFT, FIT, 1_000);
    expect(queries.get(id)).toEqual({ ...DRAFT, id, grade: GRADE, model: FIT.model, modelOf: 'key-1' });
    expect(queries.list().map((station) => station.id)).toEqual([id]);
  });

  it('replaces the examples and settings on save, and says when there was nothing to save to', () => {
    const queries = moodQueries(db);
    const id = queries.create(DRAFT, FIT, 1_000);
    const next = { ...DRAFT, name: 'Focus', examples: DRAFT.examples.slice(2), decade: null };
    expect(queries.update(id, next, { ...FIT, grade: null }, 2_000)).toBe(true);
    expect(queries.get(id)).toMatchObject({ name: 'Focus', examples: next.examples, decade: null, grade: null });
    expect(queries.update(id + 1, next, FIT, 2_000)).toBe(false);
  });

  it('keeps the grade with a model worked out again for the same examples, and drops it for others', () => {
    const queries = moodQueries(db);
    const id = queries.create(DRAFT, FIT, 1_000);
    queries.saveModel(id, Float64Array.from([1, 2, 3]), 'key-1');
    expect(queries.get(id)?.grade).toEqual(GRADE);
    queries.saveModel(id, Float64Array.from([4, 5, 6]), 'key-2');
    expect(queries.get(id)).toMatchObject({ grade: null, modelOf: 'key-2', model: Float64Array.from([4, 5, 6]) });
  });

  it('adds a mark at the end, or changes the example it names where it stands', () => {
    const queries = moodQueries(db);
    const id = queries.create(DRAFT, FIT, 1_000);
    const marked = { kind: 'track', key: 'x\tone', label: 'One – X', isYes: false, source: 'listening' } as const;
    expect(queries.mark(id, marked, 2_000)).toBe(true);
    const bach = {
      kind: 'track',
      key: 'bach\tprelude',
      label: 'Prelude – Bach',
      isYes: true,
      source: 'listening',
    } as const;
    expect(queries.mark(id, bach, 3_000)).toBe(true);
    expect(queries.get(id)?.examples.map(({ key, isYes, source }) => [key, isYes, source])).toEqual([
      ['einaudi', true, 'picked'],
      ['bach\tprelude', true, 'listening'],
      ['Lo Fi', true, 'listening'],
      ['x\tone', false, 'listening'],
    ]);
    expect(queries.mark(id + 1, marked, 4_000)).toBe(false);
  });

  it('removes a station with its examples', () => {
    const queries = moodQueries(db);
    const id = queries.create(DRAFT, FIT, 1_000);
    expect(queries.remove(id)).toBe(true);
    expect(queries.get(id)).toBeNull();
    expect(db.prepare('SELECT COUNT(*) AS n FROM station_examples').get()).toEqual({ n: 0 });
  });

  it('reads on a read-only connection, as the worker does, and ignores a grade it can’t read', () => {
    const id = moodQueries(db).create(DRAFT, FIT, 1_000);
    db.prepare('UPDATE stations SET grade = ? WHERE id = ?').run('{"kind":"great"}', id);
    const reader = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      expect(moodQueries(reader).get(id)).toMatchObject({ name: 'Study', grade: null });
    } finally {
      reader.close();
    }
  });
});
