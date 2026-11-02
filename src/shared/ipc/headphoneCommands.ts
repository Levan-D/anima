/* The headphone part of the contract. Inputs are validated in main, and the renderer imports only the types. */
import * as z from 'zod';
import type { EqImport } from '@shared/domain';
import {
  BASS_LIMIT_MAX_DB,
  BASS_LIMIT_MIN_DB,
  CORRECT_UP_TO_HZ,
  HEADPHONE_FORMS,
  HEADPHONE_KINDS,
  HEADPHONE_NAME_MAX,
  RIG_FAMILIES,
  SEAL_FITS,
  TARGET_BASS_MAX_DB,
  TARGET_BASS_MIN_DB,
  type AutoEqSearch,
  type FrCurve,
  type AutoEqTargetsFetch,
  type HeadphoneState,
} from '@shared/headphone';

const id = z.int().positive();
const kind = z.enum(HEADPHONE_KINDS);
const words = z.string().trim().min(1).max(HEADPHONE_NAME_MAX);

const command =
  <Output>() =>
  <Input extends z.ZodType>(input: Input) => ({ input, output: undefined as unknown as Output });

export const headphoneCommands = {
  'headphones.state': command<HeadphoneState>()(z.void()),
  'headphones.curve': command<FrCurve | null>()(z.strictObject({ kind, id })),
  /** Opens the file dialog in main, and makes what it reads the active one. Null if cancelled. */
  'headphones.import': command<HeadphoneState | null>()(
    z.strictObject({
      kind,
      name: words,
      source: words,
      rig: z.strictObject({ family: z.enum(RIG_FAMILIES), detail: words.nullable() }),
      form: z.enum(HEADPHONE_FORMS).nullable(),
    }),
  ),
  'headphones.select': command<HeadphoneState>()(
    z.strictObject({ measurementId: id.nullable(), targetId: id.nullable() }),
  ),
  'headphones.remove': command<HeadphoneState>()(z.strictObject({ kind, id })),
  /** One option per call. */
  'headphones.setOption': command<HeadphoneState>()(
    z.union([
      z.strictObject({ isOpen: z.boolean() }),
      z.strictObject({ showRaw: z.boolean() }),
      z.strictObject({ showDifference: z.boolean() }),
      z.strictObject({ showRange: z.boolean() }),
      z.strictObject({ bassDb: z.number().min(TARGET_BASS_MIN_DB).max(TARGET_BASS_MAX_DB) }),
    ]),
  ),
  /** The stored preset, through the same import as a file, keeping the preamp it states. */
  'headphones.usePreset': command<EqImport>()(z.strictObject({ measurementId: id })),
  /** Fits an EQ to the target as it's drawn, with this measurement's settings, and applies it unsaved. Nothing else starts one. */
  'headphones.match': command<void>()(z.strictObject({ measurementId: id, targetId: id })),
  /** One setting per call, kept with the measurement. It changes nothing until the next match. */
  'headphones.setMatch': command<HeadphoneState>()(
    z.strictObject({
      measurementId: id,
      setting: z.union([
        z.strictObject({ bassLimitDb: z.number().min(BASS_LIMIT_MIN_DB).max(BASS_LIMIT_MAX_DB) }),
        z.strictObject({ seal: z.enum(SEAL_FITS) }),
        z.strictObject({ correctUpToHz: z.union(CORRECT_UP_TO_HZ.map((hz) => z.literal(hz))) }),
      ]),
    }),
  ),
  /** On puts the EQ's off side at the EQ's level, by curve. Off puts back exactly what was there. */
  'headphones.compare': command<void>()(
    z.strictObject({ on: z.boolean(), sampleRate: z.number().min(1000).max(1_000_000) }),
  ),
  /** Downloads AutoEq's index the first time. Only ever on a request, and never while nothing's been asked for. */
  'autoeq.search': command<AutoEqSearch>()(z.strictObject({ query: z.string().trim().min(1).max(200) })),
  /** One headphone's measurement and preset, into app data, and makes it the active one. */
  'autoeq.fetch': command<HeadphoneState>()(z.strictObject({ entryId: id })),
  /** Every curve AutoEq has now, kept here for good. What's already here and unchanged isn't downloaded again. */
  'autoeq.fetchTargets': command<AutoEqTargetsFetch>()(z.void()),
};
