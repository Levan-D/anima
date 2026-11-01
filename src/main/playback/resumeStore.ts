/*
 * Where listening had got to, in the library's own database because its track ids only mean something there. The ids are
 * a row of their own, written when the queue changes, so the place can be written every few seconds and stay small.
 */

import * as z from 'zod';
import type { Connection } from '@main/db/connection';
import type { Library } from '@main/library/library';

const QUEUE_KEY = 'resume_queue';
const PLACE_KEY = 'resume_place';

const count = z.int().nonnegative();
const queueSchema = z.array(z.int());
const placeSchema = z.object({ index: count.nullable(), addedEnd: count, positionMs: z.number().nonnegative() });

export type ResumePlace = z.infer<typeof placeSchema>;
export type SavedResume = ResumePlace & { trackIds: number[] };

export type ResumeStore = {
  load(): SavedResume | null;
  saveQueue(trackIds: number[], place: ResumePlace): void;
  savePlace(place: ResumePlace): void;
};

function createQueries(db: Connection) {
  const read = db.prepare<[string], { value: string }>('SELECT value FROM library_meta WHERE key = ?');
  const write = db.prepare<[string, string]>(
    'INSERT INTO library_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  );
  return {
    value: (key: string) => read.get(key)?.value ?? null,
    savePlace: (place: ResumePlace) => write.run(PLACE_KEY, JSON.stringify(place)),
    saveQueue: db.transaction((trackIds: number[], place: ResumePlace) => {
      write.run(QUEUE_KEY, JSON.stringify(trackIds));
      write.run(PLACE_KEY, JSON.stringify(place));
    }),
  };
}

function parsed<T>(schema: z.ZodType<T>, text: string | null): T | null {
  if (text === null) return null;
  try {
    const result = schema.safeParse(JSON.parse(text));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function createResumeStore(
  library: Pick<Library, 'perConnection'>,
  log: { warn: (...details: unknown[]) => void },
): ResumeStore {
  const queries = library.perConnection(createQueries);

  // Losing a few seconds of where it was never gets in the way of the music, and a busy database is no reason to stop it.
  function attempt(work: () => void): void {
    try {
      work();
    } catch (error) {
      log.warn('Could not save where playback is', error);
    }
  }

  return {
    load() {
      const stored = queries(({ value }) => ({ queue: value(QUEUE_KEY), place: value(PLACE_KEY) }));
      if (!stored.ok) return null;
      const trackIds = parsed(queueSchema, stored.value.queue);
      const place = parsed(placeSchema, stored.value.place);
      return trackIds === null || place === null ? null : { ...place, trackIds };
    },
    saveQueue(trackIds, place) {
      attempt(() => queries(({ saveQueue }) => saveQueue(trackIds, place)));
    },
    savePlace(place) {
      attempt(() => queries(({ savePlace }) => savePlace(place)));
    },
  };
}
