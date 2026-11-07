/*
 * Headphone measurements and targets, kept per machine under app data, and what fetches them. Nothing is fetched until asked
 * for, and nothing third-party ever goes in the repo: docs/research/headphone-eq.md, under "Bundle or import".
 */

import { mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import * as z from 'zod';
import { EQ_AUTO_PREAMP, EQ_MAX_BANDS, type EqBand, type EqSettings } from '@shared/domain';
import { canCompare, matchedOff, rigMatch } from '@shared/headphoneCurve';
import { matchBands, type MatchInput } from '@shared/headphoneMatch';
import {
  AUTOEQ_COMMIT,
  autoEqTargetInfo,
  BASS_LIMIT_MAX_DB,
  BASS_LIMIT_MIN_DB,
  CORRECT_UP_TO_HZ,
  HEADPHONE_DEFAULT_OPTIONS,
  HEADPHONE_FORMS,
  MATCH_DEFAULTS,
  RIG_FAMILIES,
  SEAL_FITS,
  type AutoEqTargetsFetch,
  type FrCurve,
  type HeadphoneKind,
  type HeadphoneMeasurement,
  type HeadphoneState,
  type HeadphoneTarget,
} from '@shared/headphone';
import { eqSettingsSchema } from '@shared/ipc/contract';
import { err, errorText, ok, type Result } from '@shared/result';
import { parseApoFile } from '@main/eq/apoFile';
import { tryEqFile } from '@main/eq/presets';
import type { HandlerGroup } from '@main/ipc';
import type { SettingsStore } from '@main/settings/settings';
import {
  AUTOEQ_HEAD_URL,
  AUTOEQ_INDEX_URL,
  measurementUrls,
  parseAutoEqIndex,
  presetUrl,
  searchAutoEq,
  targetListUrl,
  targetUrl,
  type AutoEqIndexEntry,
} from './autoeqIndex';
import { parseResponseFile, RESPONSE_FILE_MAX_BYTES } from './responseFile';
import { readCappedText } from '@main/system/cappedText';
import { decodeText } from '@main/system/decodeText';
import { writeAtomically } from '@main/system/writeAtomically';

const INDEX_MAX_BYTES = 8 * 1024 * 1024;
const PRESET_MAX_BYTES = 64 * 1024;
const FILE_TIMEOUT_MS = 30_000;

const rigSchema = z.strictObject({ family: z.enum(RIG_FAMILIES), detail: z.string().nullable() });
const originSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('file') }),
  z.strictObject({ kind: z.literal('autoeq'), commit: z.string() }),
]);

const matchSchema = z.strictObject({
  bassLimitDb: z.number().min(BASS_LIMIT_MIN_DB).max(BASS_LIMIT_MAX_DB),
  seal: z.enum(SEAL_FITS),
  correctUpToHz: z.union(CORRECT_UP_TO_HZ.map((hz) => z.literal(hz))),
});

const storedSchema = z.strictObject({
  nextId: z.int().positive(),
  measurements: z.array(
    z.strictObject({
      id: z.int().positive(),
      headphone: z.string(),
      source: z.string(),
      rig: rigSchema,
      // What was stored before this was kept has none, and has to keep loading.
      form: z.enum(HEADPHONE_FORMS).nullable().default(null),
      origin: originSchema,
      hasCurve: z.boolean(),
      hasPreset: z.boolean(),
      // What was stored before there were settings has none, and has to keep loading.
      match: matchSchema.default(MATCH_DEFAULTS),
    }),
  ),
  targets: z.array(
    z.strictObject({
      id: z.int().positive(),
      name: z.string(),
      source: z.string(),
      rig: rigSchema,
      isTranslated: z.boolean(),
      origin: originSchema,
    }),
  ),
  measurementId: z.int().positive().nullable(),
  targetId: z.int().positive().nullable(),
  // Not strict: saves from when the panel's being open was remembered still carry isOpen, which goes.
  options: z.object({
    showRaw: z.boolean(),
    showDifference: z.boolean(),
    bassDb: z.number(),
    showRange: z.boolean().default(false),
  }),
  /** The EQ a comparison took over from, so it comes back even if the app dies mid-comparison. */
  comparing: eqSettingsSchema.nullable(),
  targetsFetchedAt: z.number().nullable().default(null),
  /** GitHub's id for each AutoEq curve's contents, so a refetch only downloads what's changed. */
  targetBlobs: z.record(z.string(), z.string()).default({}),
});

type Stored = z.infer<typeof storedSchema>;

const curveSchema = z
  .strictObject({ hz: z.array(z.number()), db: z.array(z.number()) })
  .refine(({ hz, db }) => hz.length === db.length);

const EMPTY: Stored = {
  nextId: 1,
  measurements: [],
  targets: [],
  measurementId: null,
  targetId: null,
  options: HEADPHONE_DEFAULT_OPTIONS,
  comparing: null,
  targetsFetchedAt: null,
  targetBlobs: {},
};

const LIST_MAX_BYTES = 256 * 1024;
const TARGET_DOWNLOADS_AT_ONCE = 6;
const headSchema = z.object({ object: z.object({ sha: z.string() }) });
const targetListSchema = z.array(z.object({ name: z.string(), sha: z.string(), type: z.string() }));

async function inBatches<Item, Done>(
  items: readonly Item[],
  size: number,
  run: (item: Item) => Promise<Done>,
): Promise<Done[]> {
  const done: Done[] = [];
  for (let at = 0; at < items.length; at += size) {
    done.push(...(await Promise.all(items.slice(at, at + size).map(run))));
  }
  return done;
}

/** The body of a file, null if it isn't there, or why it couldn't be got. */
export type Download = (url: string, maxBytes: number) => Promise<Result<string | null>>;

const OFFLINE = "AutoEq couldn't be reached. Check the connection and try again.";

/** Refuses anything bigger than it should be as it comes in, rather than after holding all of it. */
export const download: Download = async (url, maxBytes) => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(FILE_TIMEOUT_MS) });
    if (response.status === 404) return ok(null);
    if (!response.ok || response.body === null) return err('network', OFFLINE);
    const body = await readCappedText(response, maxBytes);
    if (body === null) return err('network', 'That file is bigger than it should be, so it was left alone.');
    return ok(body);
  } catch {
    return err('network', OFFLINE);
  }
};

type RunMatch = (input: MatchInput) => Promise<Result<EqBand[]>>;

type MatchAnswer = { ok: true; value: EqBand[] } | { ok: false; message: string };

/** A fit takes hundreds of milliseconds, and main never waits that long. */
export function matchInWorker(workerPath: string): RunMatch {
  return (input) =>
    new Promise((resolve) => {
      const worker = new Worker(workerPath, { workerData: input });
      worker.once('message', (answer: MatchAnswer) => {
        resolve(answer.ok ? ok(answer.value) : err('unexpected', answer.message));
      });
      worker.once('error', (error: unknown) => resolve(err('unexpected', errorText(error))));
      worker.once('exit', () => resolve(err('unexpected', 'The fit stopped before it finished')));
    });
}

type Deps = {
  /** The music folder's place for them, in its .player. Null with no music folder, when nothing is kept. */
  dir: () => string | null;
  settings: SettingsStore;
  setEq: (eq: EqSettings) => Result<void>;
  pickFile: () => Promise<string | null>;
  download?: Download;
  runMatch?: RunMatch;
  log: { error: (message: string, ...details: unknown[]) => void };
};

function stateOf({
  measurements,
  targets,
  measurementId,
  targetId,
  options,
  targetsFetchedAt,
}: Stored): HeadphoneState {
  return { measurements, targets, measurementId, targetId, options, targetsFetchedAt };
}

export function headphoneHandlers({
  dir,
  settings,
  setEq,
  pickFile,
  download: fetchFile = download,
  runMatch = (input) => Promise.resolve(ok(matchBands(input))),
  log,
}: Deps) {
  // Which folder is loaded. It follows the music folder, so each handler checks it first.
  let loadedDir: string | null = null;
  let isLoaded = false;
  const fileIn = (...parts: string[]) => (loadedDir === null ? null : join(loadedDir, ...parts));
  const stateFile = () => fileIn('headphones.json');
  const curveFile = (kind: HeadphoneKind, id: number) => fileIn('curves', `${kind}-${id}.json`);
  const presetFile = (id: number) => fileIn('presets', `${id}.txt`);
  const indexFile = () => fileIn(`autoeq-index-${AUTOEQ_COMMIT.slice(0, 12)}.md`);

  function keep(path: string | null, text: string): void {
    if (path !== null) writeAtomically(path, text);
  }

  function drop(path: string | null): void {
    if (path !== null) rmSync(path, { force: true });
  }

  function readKept(path: string | null): string {
    if (path === null) throw new Error('There is no music folder to keep headphones in');
    return readFileSync(path, 'utf8');
  }

  function load(): Stored {
    let text: string;
    try {
      text = readKept(stateFile());
    } catch {
      return EMPTY;
    }
    try {
      return storedSchema.parse(JSON.parse(text));
    } catch (error) {
      log.error('Headphone data was unreadable, so it starts empty', error);
      return EMPTY;
    }
  }

  let stored: Stored = EMPTY;
  let targetsFetching: Promise<Result<AutoEqTargetsFetch>> | null = null;

  /** One commit throughout, and each download kept only once it reads. A curve AutoEq drops stays here. */
  async function fetchTargets(): Promise<Result<AutoEqTargetsFetch>> {
    const head = await fetchFile(AUTOEQ_HEAD_URL, LIST_MAX_BYTES);
    if (!head.ok) return head;
    const commit = head.value === null ? null : headSchema.safeParse(JSON.parse(head.value));
    if (commit === null || !commit.success) return err('network', "AutoEq's list of curves didn't read");
    const { sha: commitSha } = commit.data.object;

    const listing = await fetchFile(targetListUrl(commitSha), LIST_MAX_BYTES);
    if (!listing.ok) return listing;
    const list = listing.value === null ? null : targetListSchema.safeParse(JSON.parse(listing.value));
    if (list === null || !list.success) return err('network', "AutoEq's list of curves didn't read");

    const wanted = list.data.flatMap(({ name, sha, type }) => {
      if (type !== 'file' || !name.endsWith('.csv')) return [];
      const file = name.slice(0, -'.csv'.length);
      const info = autoEqTargetInfo(file);
      const isKept = stored.targetBlobs[file] === sha && stored.targets.some((target) => target.name === file);
      return info === null || isKept ? [] : [{ file, sha, info }];
    });

    const fetched = await inBatches(wanted, TARGET_DOWNLOADS_AT_ONCE, async (item) => {
      const csv = await fetchFile(targetUrl(item.file, commitSha), RESPONSE_FILE_MAX_BYTES);
      const curve = csv.ok && csv.value !== null ? parseResponseFile(csv.value) : null;
      return curve?.ok === true ? { ...item, curve: curve.value } : null;
    });
    const good = fetched.filter((item) => item !== null);
    const failed = fetched.length - good.length;
    if (good.length === 0 && failed > 0) return err('network', OFFLINE);

    let { nextId, targets } = stored;
    const targetBlobs = { ...stored.targetBlobs };
    let added = 0;
    for (const { file, sha, info, curve } of good) {
      const origin = { kind: 'autoeq', commit: commitSha } as const;
      const known = targets.find(({ name, origin: from }) => from.kind === 'autoeq' && name === file);
      const id = known?.id ?? nextId;
      saveCurve('target', id, curve);
      targetBlobs[file] = sha;
      if (known === undefined) {
        added += 1;
        nextId += 1;
        targets = [...targets, { id, name: file, source: 'AutoEq', ...info, origin }];
      } else {
        targets = targets.map((target) => (target.id === id ? { ...target, ...info, origin } : target));
      }
    }
    const state = update({ ...stored, nextId, targets, targetBlobs, targetsFetchedAt: Date.now() });
    return ok({ state, added, updated: good.length - added, failed });
  }

  // As settings do: the change holds, and a save that fails is logged and made again with the next change.
  function update(next: Stored): HeadphoneState {
    stored = next;
    try {
      keep(stateFile(), JSON.stringify(stored));
    } catch (error) {
      log.error('Could not save the headphone data', errorText(error));
    }
    return stateOf(stored);
  }

  /** Takes up the music folder's headphones: at the start, and again whenever the music folder changes. */
  function follow(): void {
    const next = dir();
    if (isLoaded && next === loadedDir) return;
    isLoaded = true;
    loadedDir = next;
    if (loadedDir !== null) {
      try {
        mkdirSync(join(loadedDir, 'curves'), { recursive: true });
        mkdirSync(join(loadedDir, 'presets'), { recursive: true });
      } catch (error) {
        log.error('Could not make the headphones folder', errorText(error));
      }
    }
    stored = load();
    // It died in the middle of one. What was underneath comes back before anything can save over it.
    if (stored.comparing !== null) {
      setEq(stored.comparing);
      update({ ...stored, comparing: null });
    }
  }
  follow();

  /** Each handler, after making sure what it reads is the current music folder's. */
  function following<Group extends HandlerGroup>(group: Group): Group {
    // The keys and handlers stay as they were, each only wrapped, which TypeScript can't follow through a loop.
    return Object.fromEntries(
      Object.entries(group).map(([name, handle]) => [
        name,
        (input: never) => {
          follow();
          return (handle as (input: never) => unknown)(input);
        },
      ]),
    ) as Group;
  }

  function saveCurve(kind: HeadphoneKind, id: number, curve: FrCurve): void {
    keep(curveFile(kind, id), JSON.stringify(curve));
  }

  function addMeasurement(
    fields: Omit<HeadphoneMeasurement, 'id' | 'match'>,
    curve: FrCurve | null,
    preset: string | null,
  ) {
    const id = stored.nextId;
    if (curve !== null) saveCurve('measurement', id, curve);
    if (preset !== null) keep(presetFile(id), preset);
    return update({
      ...stored,
      nextId: id + 1,
      measurements: [...stored.measurements, { ...fields, id, match: MATCH_DEFAULTS }],
      measurementId: id,
    });
  }

  function addTarget(fields: Omit<HeadphoneTarget, 'id'>, curve: FrCurve) {
    const id = stored.nextId;
    saveCurve('target', id, curve);
    return update({ ...stored, nextId: id + 1, targets: [...stored.targets, { ...fields, id }], targetId: id });
  }

  function storedCurve(kind: HeadphoneKind, id: number): FrCurve | null {
    try {
      return curveSchema.parse(JSON.parse(readKept(curveFile(kind, id))));
    } catch (error) {
      const list = kind === 'measurement' ? stored.measurements : stored.targets;
      const isKnown = list.some((item) => item.id === id && (!('hasCurve' in item) || item.hasCurve));
      if (isKnown) log.error('A stored headphone curve was unreadable', errorText(error));
      return null;
    }
  }

  let index: AutoEqIndexEntry[] | null = null;

  async function autoEqIndex(): Promise<Result<AutoEqIndexEntry[]>> {
    if (index !== null) return ok(index);
    let text: string | null;
    try {
      text = readKept(indexFile());
    } catch {
      const fetched = await fetchFile(AUTOEQ_INDEX_URL, INDEX_MAX_BYTES);
      if (!fetched.ok) return fetched;
      text = fetched.value;
      if (text !== null) {
        try {
          keep(indexFile(), text);
        } catch (error) {
          // Only a copy kept for next time: it's fetched again then.
          log.error("Could not keep AutoEq's index", errorText(error));
        }
      }
    }
    const entries = text === null ? [] : parseAutoEqIndex(text);
    if (entries.length === 0) return err('network', "AutoEq's index couldn't be read.");
    index = entries;
    return ok(entries);
  }

  async function fetchFirst(urls: readonly string[]): Promise<Result<string | null>> {
    for (const url of urls) {
      const fetched = await fetchFile(url, RESPONSE_FILE_MAX_BYTES);
      if (!fetched.ok || fetched.value !== null) return fetched;
    }
    return ok(null);
  }

  return following({
    'headphones.state': () => ok(stateOf(stored)),

    'headphones.curve': ({ kind, id }) => ok(storedCurve(kind, id)),

    'headphones.import': async ({ kind, name, source, rig, form }) => {
      const path = await pickFile();
      if (path === null) return ok(null);
      let text: string;
      try {
        if (statSync(path).size > RESPONSE_FILE_MAX_BYTES) {
          return err('invalid_eq_file', 'That file is too big for a frequency response.');
        }
        text = decodeText(readFileSync(path));
      } catch {
        return err('invalid_eq_file', "That file couldn't be read");
      }
      const parsed = parseResponseFile(text);
      if (!parsed.ok) return parsed;
      const origin = { kind: 'file' } as const;
      return ok(
        kind === 'measurement'
          ? addMeasurement(
              { headphone: name, source, rig, form, origin, hasCurve: true, hasPreset: false },
              parsed.value,
              null,
            )
          : addTarget({ name, source, rig, isTranslated: false, origin }, parsed.value),
      );
    },

    'headphones.select': ({ measurementId, targetId }) => {
      const isThere = (list: readonly { id: number }[], id: number | null) =>
        id === null || list.some((item) => item.id === id);
      if (!isThere(stored.measurements, measurementId) || !isThere(stored.targets, targetId)) {
        return err('not_found', "That isn't there any more");
      }
      return ok(update({ ...stored, measurementId, targetId }));
    },

    'headphones.remove': ({ kind, id }) => {
      drop(curveFile(kind, id));
      if (kind === 'measurement') drop(presetFile(id));
      return ok(
        kind === 'measurement'
          ? update({
              ...stored,
              measurements: stored.measurements.filter((item) => item.id !== id),
              measurementId: stored.measurementId === id ? null : stored.measurementId,
            })
          : update({
              ...stored,
              targets: stored.targets.filter((item) => item.id !== id),
              targetId: stored.targetId === id ? null : stored.targetId,
            }),
      );
    },

    'headphones.setOption': (option) => ok(update({ ...stored, options: { ...stored.options, ...option } })),

    'headphones.usePreset': ({ measurementId }) => {
      const measurement = stored.measurements.find(({ id }) => id === measurementId);
      if (measurement === undefined || !measurement.hasPreset) return err('not_found', 'There is no preset with that');
      let text: string;
      try {
        text = readKept(presetFile(measurementId));
      } catch {
        return err('invalid_eq_file', "That preset couldn't be read");
      }
      return tryEqFile({ settings, setEq }, text);
    },

    'headphones.setMatch': ({ measurementId, setting }) => {
      if (!stored.measurements.some(({ id }) => id === measurementId))
        return err('not_found', "That isn't there any more");
      return ok(
        update({
          ...stored,
          measurements: stored.measurements.map((item) =>
            item.id === measurementId ? { ...item, match: { ...item.match, ...setting } } : item,
          ),
        }),
      );
    },

    'headphones.match': async ({ measurementId, targetId }) => {
      const measurement = stored.measurements.find(({ id }) => id === measurementId);
      const target = stored.targets.find(({ id }) => id === targetId);
      if (measurement === undefined || target === undefined) return err('not_found', "That isn't there any more");
      const isShown = ['defined', 'approximate'].includes(rigMatch(measurement.rig, target));
      if (!isShown) return err('invalid_input', "That target can't be shown against this measurement");
      const measured = storedCurve('measurement', measurementId);
      const aimedAt = storedCurve('target', targetId);
      if (measured === null || aimedAt === null) return err('not_found', "That curve couldn't be read");
      const fitted = await runMatch({
        measurement: measured,
        target: aimedAt,
        bassDb: stored.options.bassDb,
        maxBands: EQ_MAX_BANDS,
        settings: measurement.match,
      });
      if (!fitted.ok) return fitted;
      const eq: EqSettings = { enabled: true, bands: fitted.value, preamp: EQ_AUTO_PREAMP };
      // A hold can start while it fits, and its release would otherwise put back what this replaced.
      if (stored.comparing !== null) update({ ...stored, comparing: eq });
      else {
        const set = setEq(eq);
        if (!set.ok) return set;
      }
      settings.update({ eqPreset: null });
      return ok();
    },

    'headphones.compare': ({ on, sampleRate }) => {
      if (on) {
        if (stored.comparing !== null) return ok();
        const { eq } = settings.get();
        if (!canCompare(eq)) return err('invalid_input', 'The EQ has to be on and shaped, to compare it.');
        update({ ...stored, comparing: eq });
        return setEq(matchedOff(eq, sampleRate).eq);
      }
      const { comparing } = stored;
      if (comparing === null) return ok();
      const restored = setEq(comparing);
      update({ ...stored, comparing: null });
      return restored;
    },

    'autoeq.search': async ({ query }) => {
      const entries = await autoEqIndex();
      return entries.ok ? ok(searchAutoEq(entries.value, query)) : entries;
    },

    'autoeq.fetch': async ({ entryId }) => {
      const entries = await autoEqIndex();
      if (!entries.ok) return entries;
      const entry = entries.value.find(({ id }) => id === entryId);
      if (entry === undefined) return err('not_found', "That isn't in AutoEq's index");

      const known = stored.measurements.find(
        ({ headphone, source, rig, origin }) =>
          origin.kind === 'autoeq' &&
          headphone === entry.name &&
          source === entry.source &&
          rig.detail === entry.rig.detail,
      );
      if (known !== undefined) {
        const measurements = stored.measurements.map((item) =>
          item.id === known.id ? { ...item, form: entry.form } : item,
        );
        return ok(update({ ...stored, measurements, measurementId: known.id }));
      }

      const presetText = await fetchFile(presetUrl(entry), PRESET_MAX_BYTES);
      if (!presetText.ok) return presetText;
      // Checked here so a bad download is never kept. Using it is what applies it, and that parses it again.
      const preset = presetText.value !== null && parseApoFile(presetText.value).ok ? presetText.value : null;

      const csv = entry.isPresetOnly ? ok(null) : await fetchFirst(measurementUrls(entry));
      if (!csv.ok) return csv;
      const curve = csv.value === null ? null : parseResponseFile(csv.value);
      if (curve !== null && !curve.ok)
        return err('invalid_eq_file', `AutoEq's file for that didn't read. ${curve.error.message}`);
      if (curve === null && preset === null)
        return err('not_found', 'AutoEq has neither a measurement nor a preset for that.');

      return ok(
        addMeasurement(
          {
            headphone: entry.name,
            source: entry.source,
            rig: entry.rig,
            form: entry.form,
            origin: { kind: 'autoeq', commit: AUTOEQ_COMMIT },
            hasCurve: curve !== null,
            hasPreset: preset !== null,
          },
          curve === null ? null : curve.value,
          preset,
        ),
      );
    },

    'autoeq.fetchTargets': () => {
      targetsFetching ??= fetchTargets()
        .catch((error: unknown): Result<AutoEqTargetsFetch> => {
          log.error("AutoEq's curves couldn't be fetched", errorText(error));
          return err('network', OFFLINE);
        })
        .finally(() => {
          targetsFetching = null;
        });
      return targetsFetching;
    },
  } satisfies HandlerGroup);
}
