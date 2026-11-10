/* Mood stations in the library's database. Main writes them; the recommendation worker reads them on its own connection. */

import * as z from 'zod';
import type { Connection } from '@main/db/connection';
import type { ExampleKind, ExampleSource, MoodDraft, MoodExample, MoodGrade, MoodStation } from '@shared/stations';

export type StoredMood = MoodStation & {
  /** From `unstandardized`, so it scores vectors as they're stored. */
  model: Float64Array | null;
  /** The `fitKey` the model and grade are true of. */
  modelOf: string | null;
};

/** What a save keeps besides the draft. */
export type MoodFit = { model: Float64Array; modelOf: string; grade: MoodGrade | null };

type StationRow = {
  id: number;
  name: string;
  instrumental: 0 | 1;
  calm: 0 | 1;
  littleSinging: 0 | 1;
  genre: string | null;
  decade: number | null;
  model: Buffer | null;
  modelOf: string | null;
  grade: string | null;
};

type ExampleRow = {
  stationId: number;
  kind: ExampleKind;
  key: string;
  label: string;
  isYes: 0 | 1;
  source: ExampleSource;
};

// The database travels with the music, so what's in it is checked like anything else from outside.
const gradeSchema = z.object({
  kind: z.enum(['too-few', 'clear', 'fuzzy', 'alike']),
  examples: z.array(z.object({ index: z.int().nonnegative(), median: z.number(), isRight: z.boolean() })),
  alike: z.array(z.object({ yes: z.int().nonnegative(), no: z.int().nonnegative() })),
});

function gradeFrom(text: string | null): MoodGrade | null {
  if (text === null) return null;
  try {
    const parsed = gradeSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function modelFrom(blob: Buffer | null): Float64Array | null {
  if (blob === null || blob.byteLength % Float64Array.BYTES_PER_ELEMENT !== 0) return null;
  return new Float64Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength));
}

const blobOf = (model: Float64Array) => Buffer.from(model.buffer, model.byteOffset, model.byteLength);

function storedFrom(row: StationRow, examples: readonly ExampleRow[]): StoredMood {
  return {
    id: row.id,
    name: row.name,
    rules: { instrumental: row.instrumental === 1, calm: row.calm === 1, littleSinging: row.littleSinging === 1 },
    genre: row.genre,
    decade: row.decade,
    examples: examples.map(({ kind, key, label, isYes, source }) => ({ kind, key, label, isYes: isYes === 1, source })),
    grade: gradeFrom(row.grade),
    model: modelFrom(row.model),
    modelOf: row.modelOf,
  };
}

const STATION_COLUMNS = `id, name, instrumental, calm, little_singing AS littleSinging, genre, decade, model,
  model_of AS modelOf, grade`;
const EXAMPLE_COLUMNS = 'station_id AS stationId, kind, key, label, is_yes AS isYes, source';

export type MoodQueries = {
  list: () => StoredMood[];
  get: (stationId: number) => StoredMood | null;
  create: (draft: MoodDraft, fit: MoodFit, now: number) => number;
  /** False when there's no such station. */
  update: (stationId: number, draft: MoodDraft, fit: MoodFit, now: number) => boolean;
  /** A model worked out again for examples that now name other songs. */
  saveModel: (stationId: number, model: Float64Array, modelOf: string) => void;
  remove: (stationId: number) => boolean;
  /** An example said again where it stands, or a new one at the end. False when there's no such station. */
  mark: (stationId: number, example: MoodExample, now: number) => boolean;
};

export function moodQueries(db: Connection): MoodQueries {
  const all = db.prepare<[], StationRow>(`SELECT ${STATION_COLUMNS} FROM stations ORDER BY created_at, id`);
  const one = db.prepare<[number], StationRow>(`SELECT ${STATION_COLUMNS} FROM stations WHERE id = ?`);
  const allExamples = db.prepare<[], ExampleRow>(
    `SELECT ${EXAMPLE_COLUMNS} FROM station_examples ORDER BY station_id, position`,
  );
  const examplesOf = db.prepare<[number], ExampleRow>(
    `SELECT ${EXAMPLE_COLUMNS} FROM station_examples WHERE station_id = ? ORDER BY position`,
  );
  const insert = db.prepare<[string, number, number, number, string | null, number | null, number, number]>(
    `INSERT INTO stations (name, instrumental, calm, little_singing, genre, decade, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const update = db.prepare<[string, number, number, number, string | null, number | null, number, number]>(
    `UPDATE stations SET name = ?, instrumental = ?, calm = ?, little_singing = ?, genre = ?, decade = ?, updated_at = ?
     WHERE id = ?`,
  );
  const setFit = db.prepare<[Buffer, string, string | null, number]>(
    'UPDATE stations SET model = ?, model_of = ?, grade = ? WHERE id = ?',
  );
  const setModel = db.prepare<[Buffer, string, string, number]>(
    // The grade goes with the examples it was worked out on, so a model for others clears it.
    'UPDATE stations SET model = ?, grade = CASE WHEN model_of = ? THEN grade END, model_of = ? WHERE id = ?',
  );
  const clearExamples = db.prepare<[number]>('DELETE FROM station_examples WHERE station_id = ?');
  const insertExample = db.prepare<[number, number, ExampleKind, string, string, number, ExampleSource]>(
    `INSERT INTO station_examples (station_id, position, kind, key, label, is_yes, source) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (station_id, kind, key) DO NOTHING`,
  );
  const remove = db.prepare<[number]>('DELETE FROM stations WHERE id = ?');
  const touch = db.prepare<[number, number]>('UPDATE stations SET updated_at = ? WHERE id = ?');
  const markExample = db.prepare<[number, number, ExampleKind, string, string, number, ExampleSource]>(
    `INSERT INTO station_examples (station_id, position, kind, key, label, is_yes, source)
     VALUES (?, (SELECT COALESCE(MAX(position), -1) + 1 FROM station_examples WHERE station_id = ?), ?, ?, ?, ?, ?)
     ON CONFLICT (station_id, kind, key) DO UPDATE SET label = excluded.label, is_yes = excluded.is_yes, source = excluded.source`,
  );

  const writeExamples = (stationId: number, draft: MoodDraft) => {
    clearExamples.run(stationId);
    draft.examples.forEach(({ kind, key, label, isYes, source }, position) =>
      insertExample.run(stationId, position, kind, key, label, isYes ? 1 : 0, source),
    );
  };
  const settings = ({ name, rules, genre, decade }: MoodDraft) =>
    [name, rules.instrumental ? 1 : 0, rules.calm ? 1 : 0, rules.littleSinging ? 1 : 0, genre, decade] as const;
  const writeFit = (stationId: number, { model, modelOf, grade }: MoodFit) =>
    setFit.run(blobOf(model), modelOf, grade === null ? null : JSON.stringify(grade), stationId);

  return {
    list(): StoredMood[] {
      const examples = Map.groupBy(allExamples.all(), ({ stationId }) => stationId);
      return all.all().map((row) => storedFrom(row, examples.get(row.id) ?? []));
    },
    get(stationId: number): StoredMood | null {
      const row = one.get(stationId);
      return row === undefined ? null : storedFrom(row, examplesOf.all(stationId));
    },
    create: db.transaction((draft: MoodDraft, fit: MoodFit, now: number): number => {
      const { lastInsertRowid } = insert.run(...settings(draft), now, now);
      const stationId = Number(lastInsertRowid);
      writeExamples(stationId, draft);
      writeFit(stationId, fit);
      return stationId;
    }),
    update: db.transaction((stationId: number, draft: MoodDraft, fit: MoodFit, now: number): boolean => {
      if (update.run(...settings(draft), now, stationId).changes === 0) return false;
      writeExamples(stationId, draft);
      writeFit(stationId, fit);
      return true;
    }),
    saveModel(stationId: number, model: Float64Array, modelOf: string): void {
      setModel.run(blobOf(model), modelOf, modelOf, stationId);
    },
    remove: (stationId: number): boolean => remove.run(stationId).changes > 0,
    mark: db.transaction(
      (stationId: number, { kind, key, label, isYes, source }: MoodExample, now: number): boolean => {
        if (touch.run(now, stationId).changes === 0) return false;
        markExample.run(stationId, stationId, kind, key, label, isYes ? 1 : 0, source);
        return true;
      },
    ),
  };
}
