import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import * as z from 'zod';
import {
  EQ_AUTO_PREAMP,
  EQ_DEFAULT_LAYERS,
  EQ_MAX_BANDS,
  EQ_MAX_GAIN_DB,
  EQ_MAX_PREAMP_DB,
  EQ_MIN_PREAMP_DB,
  OUTPUT_MODES,
  REPLAY_GAIN_MODES,
  STAY_AWAKE_DEFAULT,
  WANDER_MIDDLE,
  RADIO_ENERGY_DEFAULT,
  STAY_AWAKE_MODES,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  type AppSettings,
} from '@shared/domain';
import { eqBandSchema, radioEnergySchema, themeSeasonSchema } from '@shared/ipc/contract';
import { SEASON_STAY_MAX, SEASONS_DEFAULT, THEME_IDS } from '@shared/themes';
import { ok } from '@shared/result';
import type { HandlerGroup } from '@main/ipc';

const windowBoundsSchema = z.object({
  x: z.int(),
  y: z.int(),
  width: z.int().positive(),
  height: z.int().positive(),
  isMaximized: z.boolean(),
});

export type WindowBounds = z.infer<typeof windowBoundsSchema>;

const windowPositionSchema = z.object({ x: z.int(), y: z.int() });

export type WindowPosition = z.infer<typeof windowPositionSchema>;

// Older files can hold more gain than there is now, and no preamp at all. Those come down to what's allowed, never refused.
const clampTo = (low: number, high: number) => z.number().transform((value) => Math.min(Math.max(value, low), high));
const savedBands = z.array(eqBandSchema.extend({ gainDb: clampTo(-EQ_MAX_GAIN_DB, EQ_MAX_GAIN_DB) })).max(EQ_MAX_BANDS);
const savedPreamp = z
  .object({ auto: z.boolean(), db: clampTo(EQ_MIN_PREAMP_DB, EQ_MAX_PREAMP_DB) })
  .catch(EQ_AUTO_PREAMP);

// Every field falls back on its own, so one bad value can't reset the rest of the file.
const fileSchema = z.object({
  libraryFolder: z.string().min(1).nullable().catch(null),
  volume: z.number().min(0).max(100).catch(100),
  muted: z.boolean().catch(false),
  outputMode: z.enum(OUTPUT_MODES).catch('shared'),
  replayGainMode: z.enum(REPLAY_GAIN_MODES).catch('album'),
  eq: z
    .object({ enabled: z.boolean(), bands: savedBands, preamp: savedPreamp })
    .catch({ enabled: false, bands: [], preamp: EQ_AUTO_PREAMP }),
  eqPresets: z.array(z.object({ name: z.string().min(1), bands: savedBands, preamp: savedPreamp })).catch([]),
  eqPreset: z.string().nullable().catch(null),
  eqLayers: z.object({ words: z.boolean(), instruments: z.boolean(), ear: z.boolean() }).catch(EQ_DEFAULT_LAYERS),
  // A size saved when the top of the range was higher stays as big as it can, rather than falling back to 1.
  uiScale: z
    .number()
    .transform((scale) => Math.min(Math.max(scale, UI_SCALE_MIN), UI_SCALE_MAX))
    .catch(1),
  fetchLyricsOnline: z.boolean().catch(true),
  endless: z.boolean().catch(false),
  radioWander: z.number().min(0).max(1).catch(WANDER_MIDDLE),
  radioEnergy: radioEnergySchema.catch(RADIO_ENERGY_DEFAULT),
  // A theme the file doesn't know yet takes its defaults, and those it knows keep what the person chose.
  seasons: z
    .object({
      isOn: z.boolean(),
      stay: z.number().min(0).max(SEASON_STAY_MAX),
      themes: z.partialRecord(z.enum(THEME_IDS), themeSeasonSchema),
    })
    .transform((seasons) => ({ ...seasons, themes: { ...SEASONS_DEFAULT.themes, ...seasons.themes } }))
    .catch(SEASONS_DEFAULT),
  stayAwake: z
    .object({
      pluggedIn: z.enum(STAY_AWAKE_MODES).catch(STAY_AWAKE_DEFAULT.pluggedIn),
      onBattery: z.enum(STAY_AWAKE_MODES).catch(STAY_AWAKE_DEFAULT.onBattery),
    })
    .catch(STAY_AWAKE_DEFAULT),
  windowBounds: windowBoundsSchema.nullable().catch(null),
  miniPlayerPosition: windowPositionSchema.nullable().catch(null),
});

type SettingsFile = z.infer<typeof fileSchema>;

export const DEFAULT_SETTINGS: AppSettings = toAppSettings(fileSchema.parse({}));

function toAppSettings({
  windowBounds: _bounds,
  miniPlayerPosition: _position,
  ...settings
}: SettingsFile): AppSettings {
  return settings;
}

type Options = {
  debounceMs?: number;
  onError?: (message: string, error: unknown) => void;
};

type ChangeListener = (settings: AppSettings) => void;

export type SettingsStore = {
  get(): AppSettings;
  update(patch: Partial<AppSettings>): AppSettings;
  windowBounds(): WindowBounds | null;
  setWindowBounds(bounds: WindowBounds): void;
  miniPlayerPosition(): WindowPosition | null;
  setMiniPlayerPosition(position: WindowPosition): void;
  onChange(listener: ChangeListener): void;
  flush(): void;
};

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function readFile(path: string, onError: NonNullable<Options['onError']>): SettingsFile {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if (!isMissingFile(error)) onError('Could not read the settings file', error);
    return fileSchema.parse({});
  }

  function setAside(reason: unknown): SettingsFile {
    onError('The settings file is corrupt, keeping a copy as .bad and using defaults', reason);
    try {
      renameSync(path, `${path}.bad`);
    } catch (renameError) {
      onError('Could not back up the corrupt settings file', renameError);
    }
    return fileSchema.parse({});
  }

  let json: unknown;
  try {
    // Notepad can save with a BOM, which JSON.parse refuses.
    json = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (error) {
    return setAside(error);
  }

  const parsed = fileSchema.safeParse(json);
  return parsed.success ? parsed.data : setAside(parsed.error);
}

export function openSettings(path: string, options: Options = {}): SettingsStore {
  const { debounceMs = 300, onError = () => {} } = options;
  let file = readFile(path, onError);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const listeners: ChangeListener[] = [];

  function save(): void {
    timer = null;
    const temp = `${path}.tmp`;
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(temp, JSON.stringify(file, null, 2));
      renameSync(temp, path);
    } catch (error) {
      onError('Could not save the settings file', error);
    }
  }

  function scheduleSave(): void {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(save, debounceMs);
  }

  return {
    get: () => toAppSettings(file),
    update(patch) {
      file = { ...file, ...patch };
      scheduleSave();
      const settings = toAppSettings(file);
      for (const listener of listeners) listener(settings);
      return settings;
    },
    windowBounds: () => file.windowBounds,
    setWindowBounds(bounds) {
      file = { ...file, windowBounds: bounds };
      scheduleSave();
    },
    miniPlayerPosition: () => file.miniPlayerPosition,
    setMiniPlayerPosition(position) {
      file = { ...file, miniPlayerPosition: position };
      scheduleSave();
    },
    onChange(listener) {
      listeners.push(listener);
    },
    flush() {
      if (timer === null) return;
      clearTimeout(timer);
      save();
    },
  };
}

export function settingsHandlers(settings: SettingsStore) {
  return {
    'settings.get': () => ok(settings.get()),
    'settings.update': (patch) => ok(settings.update(patch)),
  } satisfies HandlerGroup;
}
