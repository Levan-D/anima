/* The mood station part of the contract. Inputs are validated in main, and the renderer imports only the types. */
import * as z from 'zod';
import {
  EXAMPLE_KINDS,
  EXAMPLE_SOURCES,
  MOOD_EXAMPLES_MAX,
  MOOD_NAME_MAX,
  type MoodCard,
  type MoodFind,
  type MoodGrade,
  type MoodStation,
  type MoodTry,
} from '@shared/stations';
import { command, id } from './commandSchema';

const example = z.strictObject({
  kind: z.enum(EXAMPLE_KINDS),
  key: z.string().min(1).max(1_000),
  label: z.string().max(1_000),
  isYes: z.boolean(),
  source: z.enum(EXAMPLE_SOURCES),
});

/** What plays: without a name, which a draft being tried may not have yet. */
const settings = z.strictObject({
  examples: z.array(example).max(MOOD_EXAMPLES_MAX),
  rules: z.strictObject({ instrumental: z.boolean(), calm: z.boolean(), littleSinging: z.boolean() }),
  genre: z.string().min(1).max(200).nullable(),
  decade: z.int().min(1900).max(2100).multipleOf(10).nullable(),
});

const draft = settings.extend({ name: z.string().trim().min(1).max(MOOD_NAME_MAX) });

/** The station being edited, if it's been saved, so its kept model and grade count. */
const stationId = id.nullable();

export const moodCommands = {
  'moods.list': command<MoodCard[]>()(z.void()),
  'moods.get': command<MoodStation>()(z.strictObject({ stationId: id })),
  'moods.search': command<MoodFind[]>()(z.strictObject({ text: z.string().max(200) })),
  /** What a draft would play and what to ask about next. `skipped` are songs not to ask about again. */
  'moods.try': command<MoodTry>()(z.strictObject({ stationId, draft: settings, skipped: z.array(id).max(10_000) })),
  /** Seconds of work, told along the way in `moods.grading`. Fails as `superseded` when a newer draft takes over. */
  'moods.grade': command<MoodGrade>()(z.strictObject({ stationId, draft: settings })),
  'moods.save': command<{ stationId: number }>()(z.strictObject({ stationId, draft })),
  'moods.delete': command<void>()(z.strictObject({ stationId: id })),
  /** While a station plays: this song belongs in it, or doesn't. It counts from the next pick. */
  'moods.mark': command<void>()(z.strictObject({ stationId: id, trackId: id, isYes: z.boolean() })),
};
