import { mkdirSync, readFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import * as z from 'zod';
import {
  EQ_AUTO_PREAMP,
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
import { checkAddress, ONLINE_SERVICE_IDS, ONLINE_SERVICES_DEFAULT, SCRIPT_MAX_CHARS } from '@shared/onlineServices';
import { SEASON_STAY_MAX, SEASONS_DEFAULT, THEME_IDS } from '@shared/themes';
import { ok } from '@shared/result';
import type { HandlerGroup } from '@main/ipc';
import { writeAtomically } from '@main/system/writeAtomically';

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

/*
 * Two files. This PC's holds where the music folder is and what depends on this PC: its screen, its speakers, its power.
 * The rest is the person's and lives in the music folder's .player, beside the library, so it goes wherever the music
 * goes. Every field falls back on its own, so one bad value can't reset the rest of a file.
 */
const machineSchema = z.object({
  libraryFolder: z.string().min(1).nullable().catch(null),
  volume: z.number().min(0).max(100).catch(100),
  muted: z.boolean().catch(false),
  outputMode: z.enum(OUTPUT_MODES).catch('shared'),
  // A size saved when the top of the range was higher stays as big as it can, rather than falling back to 1.
  uiScale: z
    .number()
    .transform((scale) => Math.min(Math.max(scale, UI_SCALE_MIN), UI_SCALE_MAX))
    .catch(1),
  stayAwake: z
    .object({
      pluggedIn: z.enum(STAY_AWAKE_MODES).catch(STAY_AWAKE_DEFAULT.pluggedIn),
      onBattery: z.enum(STAY_AWAKE_MODES).catch(STAY_AWAKE_DEFAULT.onBattery),
    })
    .catch(STAY_AWAKE_DEFAULT),
  windowBounds: windowBoundsSchema.nullable().catch(null),
  miniPlayerPosition: windowPositionSchema.nullable().catch(null),
});

const librarySchema = z.object({
  replayGainMode: z.enum(REPLAY_GAIN_MODES).catch('album'),
  eq: z
    .object({ enabled: z.boolean(), bands: savedBands, preamp: savedPreamp })
    .catch({ enabled: false, bands: [], preamp: EQ_AUTO_PREAMP }),
  eqPresets: z.array(z.object({ name: z.string().min(1), bands: savedBands, preamp: savedPreamp })).catch([]),
  eqPreset: z.string().nullable().catch(null),
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
  // A service missing from the file takes its defaults, one the app no longer has is dropped, and so is an address
  // that no longer passes, for the service's own.
  onlineServices: z
    .record(
      z.string(),
      z.object({
        isOn: z.boolean().catch(true),
        address: z
          .string()
          .nullable()
          .transform((address) => {
            if (address === null) return null;
            const checked = checkAddress(address);
            return checked.ok ? checked.value : null;
          })
          .catch(null),
        script: z.string().max(SCRIPT_MAX_CHARS).nullable().catch(null),
      }),
    )
    .transform((saved) => {
      const services = { ...ONLINE_SERVICES_DEFAULT };
      for (const id of ONLINE_SERVICE_IDS) services[id] = saved[id] ?? ONLINE_SERVICES_DEFAULT[id];
      return services;
    })
    .catch(ONLINE_SERVICES_DEFAULT),
});

type MachineFile = z.infer<typeof machineSchema>;
type LibraryFile = z.infer<typeof librarySchema>;

const LIBRARY_KEYS: ReadonlySet<string> = new Set(librarySchema.keyof().options);

function toAppSettings(
  { windowBounds: _bounds, miniPlayerPosition: _position, ...machine }: MachineFile,
  library: LibraryFile,
): AppSettings {
  return { ...machine, ...library };
}

export const DEFAULT_SETTINGS: AppSettings = toAppSettings(machineSchema.parse({}), librarySchema.parse({}));

type Paths = {
  /** This PC's file. */
  path: string;
  /** Where the person's file is for a music folder: in its .player, or what stands in for that in development. */
  libraryFileFor: (folder: string) => string;
};

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
  /** The music folder changed, and with it the person's settings, which whatever applies them has to take up again. */
  onLibraryChange(listener: ChangeListener): void;
  flush(): void;
};

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function readFile<Shape extends z.ZodType>(
  schema: Shape,
  path: string,
  onError: NonNullable<Options['onError']>,
): z.infer<Shape> {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if (!isMissingFile(error)) onError(`Could not read ${path}`, error);
    return schema.parse({});
  }

  function setAside(reason: unknown): z.infer<Shape> {
    onError(`${path} is corrupt, keeping a copy as .bad and using defaults`, reason);
    try {
      renameSync(path, `${path}.bad`);
    } catch (renameError) {
      onError(`Could not back up the corrupt ${path}`, renameError);
    }
    return schema.parse({});
  }

  let json: unknown;
  try {
    // Notepad can save with a BOM, which JSON.parse refuses.
    json = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (error) {
    return setAside(error);
  }

  const parsed = schema.safeParse(json);
  return parsed.success ? parsed.data : setAside(parsed.error);
}

type JsonFile<Data> = {
  readonly data: Data;
  set(next: Data): void;
  flush(): void;
};

/** One settings file, saved a moment after the last change. With no path it's kept in memory only. */
function jsonFile<Shape extends z.ZodType>(
  schema: Shape,
  path: string | null,
  { debounceMs, onError }: Required<Options>,
): JsonFile<z.infer<Shape>> {
  let data: z.infer<Shape> = path === null ? schema.parse({}) : readFile(schema, path, onError);
  let timer: ReturnType<typeof setTimeout> | null = null;

  function save(): void {
    timer = null;
    if (path === null) return;
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeAtomically(path, JSON.stringify(data, null, 2));
    } catch (error) {
      onError(`Could not save ${path}`, error);
    }
  }

  return {
    get data() {
      return data;
    },
    set(next) {
      data = next;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(save, debounceMs);
    },
    flush() {
      if (timer === null) return;
      clearTimeout(timer);
      save();
    },
  };
}

function partOf<Part>(patch: Partial<AppSettings>, isLibrary: boolean): Partial<Part> {
  // The keys tell the two files apart, and each file's schema has already vouched for its values' types.
  return Object.fromEntries(
    Object.entries(patch).filter(([key]) => LIBRARY_KEYS.has(key) === isLibrary),
  ) as Partial<Part>;
}

export function openSettings({ path, libraryFileFor }: Paths, options: Options = {}): SettingsStore {
  const fileOptions = { debounceMs: options.debounceMs ?? 300, onError: options.onError ?? (() => {}) };
  const machine = jsonFile(machineSchema, path, fileOptions);
  const libraryFileOf = (folder: string | null) => (folder === null ? null : libraryFileFor(folder));
  let library = jsonFile(librarySchema, libraryFileOf(machine.data.libraryFolder), fileOptions);
  const listeners: ChangeListener[] = [];
  const libraryListeners: ChangeListener[] = [];
  const current = () => toAppSettings(machine.data, library.data);

  return {
    get: current,
    update(patch) {
      const folderBefore = machine.data.libraryFolder;
      const machinePart = partOf<MachineFile>(patch, false);
      if (Object.keys(machinePart).length > 0) machine.set({ ...machine.data, ...machinePart });
      const isNewFolder = machine.data.libraryFolder !== folderBefore;
      if (isNewFolder) {
        library.flush();
        library = jsonFile(librarySchema, libraryFileOf(machine.data.libraryFolder), fileOptions);
      }
      const libraryPart = partOf<LibraryFile>(patch, true);
      if (Object.keys(libraryPart).length > 0) library.set({ ...library.data, ...libraryPart });

      const next = current();
      for (const listener of listeners) listener(next);
      if (isNewFolder) for (const listener of libraryListeners) listener(next);
      return next;
    },
    windowBounds: () => machine.data.windowBounds,
    setWindowBounds(bounds) {
      machine.set({ ...machine.data, windowBounds: bounds });
    },
    miniPlayerPosition: () => machine.data.miniPlayerPosition,
    setMiniPlayerPosition(position) {
      machine.set({ ...machine.data, miniPlayerPosition: position });
    },
    onChange(listener) {
      listeners.push(listener);
    },
    onLibraryChange(listener) {
      libraryListeners.push(listener);
    },
    flush() {
      machine.flush();
      library.flush();
    },
  };
}

export function settingsHandlers(settings: SettingsStore) {
  return {
    'settings.get': () => ok(settings.get()),
    'settings.update': (patch) => ok(settings.update(patch)),
  } satisfies HandlerGroup;
}
