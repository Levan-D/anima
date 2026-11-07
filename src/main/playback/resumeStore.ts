/*
 * Where listening had got to, in the library's own database because its track ids only mean something there. The ids are
 * a row of their own, written when the queue changes, so the place can be written every few seconds and stay small.
 */

import * as z from 'zod';
import type { QueueFrom } from '@shared/domain';
import type { Connection } from '@main/db/connection';
import type { Library } from '@main/library/library';

const QUEUE_KEY = 'resume_queue';
const PLACE_KEY = 'resume_place';
const RADIO_KEY = 'resume_radio';
const FROM_KEY = 'resume_from';

const count = z.int().nonnegative();
const queueSchema = z.array(z.int());
const placeSchema = z.object({ index: count.nullable(), addedEnd: count, positionMs: z.number().nonnegative() });
const radioSchema = z.object({
  skipped: queueSchema,
  within: z
    .discriminatedUnion('kind', [z.object({ kind: z.literal('genre'), genre: z.string() })])
    .nullable()
    .default(null),
});

const fromSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('playlist'), playlistId: z.int().positive() }),
]);

export type ResumePlace = z.infer<typeof placeSchema>;
/** There when radio was what was playing, in which case the queue and place are radio's own. */
export type SavedRadio = z.infer<typeof radioSchema>;
export type SavedResume = ResumePlace & { trackIds: number[]; radio: SavedRadio | null; from: QueueFrom | null };

export type ResumeStore = {
  load(): SavedResume | null;
  saveQueue(trackIds: number[], place: ResumePlace, radio: SavedRadio | null, from: QueueFrom | null): void;
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
    // Together, so a crash can't leave radio's queue without what says it's radio's.
    saveQueue: db.transaction(
      (trackIds: number[], place: ResumePlace, radio: SavedRadio | null, from: QueueFrom | null) => {
        write.run(QUEUE_KEY, JSON.stringify(trackIds));
        write.run(PLACE_KEY, JSON.stringify(place));
        write.run(RADIO_KEY, JSON.stringify(radio));
        write.run(FROM_KEY, JSON.stringify(from));
      },
    ),
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
      const stored = queries(({ value }) => ({
        queue: value(QUEUE_KEY),
        place: value(PLACE_KEY),
        radio: value(RADIO_KEY),
        from: value(FROM_KEY),
      }));
      if (!stored.ok) return null;
      const trackIds = parsed(queueSchema, stored.value.queue);
      const place = parsed(placeSchema, stored.value.place);
      if (trackIds === null || place === null) return null;
      return {
        ...place,
        trackIds,
        radio: parsed(radioSchema, stored.value.radio),
        from: parsed(fromSchema, stored.value.from),
      };
    },
    saveQueue(trackIds, place, radio, from) {
      attempt(() => queries(({ saveQueue }) => saveQueue(trackIds, place, radio, from)));
    },
    savePlace(place) {
      attempt(() => queries(({ savePlace }) => savePlace(place)));
    },
  };
}
