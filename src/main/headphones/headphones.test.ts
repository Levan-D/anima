/* The store and the fetch, with a fake download. Every number here is made up. */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { EqSettings } from '@shared/domain';
import { AUTOEQ_COMMIT, MATCH_DEFAULTS, type HeadphoneState } from '@shared/headphone';
import { err, ok, type Result } from '@shared/result';
import { tempDir } from '@main/library/testFixtures';
import { makeSettings } from '@main/playback/testFixtures';
import type { SettingsStore } from '@main/settings/settings';
import { headphoneHandlers, type Download } from './headphones';

const CSV = ['frequency,raw', '20,-4', '100,-1', '300,0', '1000,1', '3000,6', '6000,2', '10000,-3', '20000,-10'].join(
  '\n',
);
const PRESET = [
  'Preamp: -3.2 dB',
  'Filter 1: ON LSC Fc 105 Hz Gain 2.5 dB Q 0.70',
  'Filter 2: ON PK Fc 3000 Hz Gain -4.0 dB Q 1.50',
].join('\n');
const INDEX = [
  '# Index',
  '- [Acme One](./oratory1990/over-ear/Acme%20One) by oratory1990',
  '- [Acme In](./crinacle/711%20in-ear/Acme%20In) by crinacle on 711',
].join('\n');

const base = `https://raw.githubusercontent.com/jaakkopasanen/AutoEq/${AUTOEQ_COMMIT}`;
const FILES: Record<string, string> = {
  [`${base}/results/INDEX.md`]: INDEX,
  [`${base}/results/oratory1990/over-ear/Acme%20One/Acme%20One%20ParametricEQ.txt`]: PRESET,
  [`${base}/results/crinacle/711%20in-ear/Acme%20In/Acme%20In%20ParametricEQ.txt`]: PRESET,
  [`${base}/measurements/oratory1990/data/over-ear/Acme%20One.csv`]: CSV,
};

const API = 'https://api.github.com/repos/jaakkopasanen/AutoEq';
const NEW_COMMIT = 'abc123';
const raw = `https://raw.githubusercontent.com/jaakkopasanen/AutoEq/${NEW_COMMIT}`;
const listing = (files: { name: string; sha: string }[]) =>
  JSON.stringify(files.map((file) => ({ ...file, type: 'file' })));
const TARGET_FILES: Record<string, string> = {
  [`${API}/git/ref/heads/master`]: JSON.stringify({ object: { sha: NEW_COMMIT } }),
  [`${API}/contents/targets?ref=${NEW_COMMIT}`]: listing([
    { name: 'Harman over-ear 2018.csv', sha: 'one' },
    { name: 'Some new curve.csv', sha: 'two' },
    { name: 'zero.csv', sha: 'three' },
  ]),
  [`${raw}/targets/Harman%20over-ear%202018.csv`]: CSV,
  [`${raw}/targets/Some%20new%20curve.csv`]: CSV,
};

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

const SHAPED: EqSettings = {
  enabled: true,
  bands: [{ id: 1, kind: 'peak', frequencyHz: 1000, gainDb: 4, q: 1 }],
  preamp: { auto: true, db: 0 },
};

describe('headphoneHandlers', () => {
  let dir: string;
  let settings: ReturnType<typeof makeSettings>;
  let applied: EqSettings[];
  let picked: string | null;
  let asked: string[];
  let errors: unknown[];
  let down: boolean;
  let targetFiles: Record<string, string>;

  const fake: Download = (url, maxBytes) => {
    asked.push(url);
    if (down) return Promise.resolve(err('network', 'offline'));
    const body = FILES[url] ?? targetFiles[url] ?? null;
    if (body !== null && body.length > maxBytes) return Promise.resolve(err('network', 'too big'));
    return Promise.resolve(ok(body));
  };

  const open = () =>
    headphoneHandlers({
      dir,
      settings: settings as unknown as SettingsStore,
      setEq: (eq) => {
        applied.push(eq);
        settings.update({ eq });
        return ok();
      },
      pickFile: () => Promise.resolve(picked),
      download: fake,
      log: { error: (...details: unknown[]) => errors.push(details) },
    });

  let dirCount = 0;

  beforeEach(() => {
    dirCount++;
    dir = join(tempDir('headphones'), String(dirCount));
    settings = makeSettings({ eq: SHAPED });
    applied = [];
    picked = null;
    asked = [];
    targetFiles = TARGET_FILES;
    errors = [];
    down = false;
  });

  const measurementRequest = {
    kind: 'measurement',
    name: 'Made Up One',
    source: 'Me',
    rig: { family: 'ears', detail: null },
  } as const;

  function fileOf(name: string, text: string): string {
    const path = join(dir, name);
    writeFileSync(path, text);
    return path;
  }

  describe('matching to a target', () => {
    async function withBoth(targetRig: { family: 'ears' | 'hms'; detail: null } = { family: 'ears', detail: null }) {
      const handlers = open();
      picked = fileOf('measured.csv', CSV);
      const measured = unwrap(await handlers['headphones.import'](measurementRequest));
      picked = fileOf('target.csv', CSV.replace('3000,6', '3000,2'));
      const both = unwrap(
        await handlers['headphones.import']({ ...measurementRequest, kind: 'target', rig: targetRig }),
      );
      return {
        handlers,
        measurementId: measured?.measurementId ?? 0,
        targetId: both?.targetId ?? 0,
      };
    }

    it('applies the fit unsaved, on, with Auto preamp', async () => {
      const { handlers, measurementId, targetId } = await withBoth();
      settings.update({ eqPreset: 'Old' });
      unwrap(await handlers['headphones.match']({ measurementId, targetId }));
      const eq = applied.at(-1);
      expect(eq?.enabled).toBe(true);
      expect(eq?.preamp).toEqual({ auto: true, db: 0 });
      expect(eq?.bands.length).toBeGreaterThan(0);
      expect(settings.get().eqPreset).toBeNull();
    });

    it('refuses a target on another rig, and leaves the EQ alone', async () => {
      const { handlers, measurementId, targetId } = await withBoth({ family: 'hms', detail: null });
      expect((await handlers['headphones.match']({ measurementId, targetId })).ok).toBe(false);
      expect(applied).toEqual([]);
    });

    it('fits with the settings kept on that measurement, and they survive a restart', async () => {
      const { handlers, measurementId, targetId } = await withBoth();
      unwrap(await handlers['headphones.match']({ measurementId, targetId }));
      const before = applied.at(-1);
      const after = unwrap(handlers['headphones.setMatch']({ measurementId, setting: { bassLimitDb: 1 } }));
      expect(after.measurements[0]?.match.bassLimitDb).toBe(1);
      expect(applied.at(-1)).toBe(before);
      unwrap(await handlers['headphones.match']({ measurementId, targetId }));
      expect(applied.at(-1)?.bands).not.toEqual(before?.bands);
      expect(unwrap(open()['headphones.state']()).measurements[0]?.match.bassLimitDb).toBe(1);
    });

    it('reads a measurement stored before there were settings', async () => {
      await withBoth();
      const file = join(dir, 'headphones.json');
      const stored = JSON.parse(readFileSync(file, 'utf8')) as { measurements: { match?: unknown }[] };
      for (const measurement of stored.measurements) delete measurement.match;
      writeFileSync(file, JSON.stringify(stored));
      expect(unwrap(open()['headphones.state']()).measurements[0]?.match).toEqual(MATCH_DEFAULTS);
    });
  });

  describe('importing a file', () => {
    it('stores what the person declared, and makes it active', async () => {
      const handlers = open();
      picked = fileOf('one.csv', CSV);
      const state = unwrap(await handlers['headphones.import'](measurementRequest));
      expect(state?.measurementId).toBe(state?.measurements[0]?.id);
      expect(state?.measurements[0]).toMatchObject({
        headphone: 'Made Up One',
        source: 'Me',
        rig: { family: 'ears', detail: null },
        origin: { kind: 'file' },
        hasCurve: true,
        hasPreset: false,
      });
      const curve = unwrap(handlers['headphones.curve']({ kind: 'measurement', id: state?.measurementId ?? 0 }));
      expect(curve?.hz).toHaveLength(8);
    });

    it('is nothing if cancelled', async () => {
      expect(unwrap(await open()['headphones.import'](measurementRequest))).toBeNull();
    });

    it('stores nothing when the file is refused, and says which line', async () => {
      const handlers = open();
      picked = fileOf('bad.csv', 'frequency,raw\n20,1\n100,oops');
      const result = await handlers['headphones.import'](measurementRequest);
      expect(result).toEqual(err('invalid_eq_file', 'Line 3: can\'t read "oops" as a level'));
      expect(unwrap(handlers['headphones.state']()).measurements).toEqual([]);
    });

    it('refuses a file that is too big, before reading it', async () => {
      const handlers = open();
      picked = fileOf('huge.csv', 'x'.repeat(8 * 1024 * 1024 + 1));
      const result = await handlers['headphones.import'](measurementRequest);
      expect(result.ok ? '' : result.error.message).toContain('too big');
    });

    it('keeps several, with one active at a time', async () => {
      const handlers = open();
      picked = fileOf('one.csv', CSV);
      const first = unwrap(await handlers['headphones.import'](measurementRequest));
      const second = unwrap(await handlers['headphones.import']({ ...measurementRequest, name: 'Made Up Two' }));
      expect(second?.measurements).toHaveLength(2);
      expect(second?.measurementId).toBe(second?.measurements[1]?.id);
      const chosen = unwrap(
        handlers['headphones.select']({ measurementId: first?.measurementId ?? 0, targetId: null }),
      );
      expect(chosen.measurementId).toBe(first?.measurementId);
    });

    it('imports a target with its rig', async () => {
      const handlers = open();
      picked = fileOf('target.txt', CSV.replaceAll(',', '\t'));
      const state = unwrap(
        await handlers['headphones.import']({
          kind: 'target',
          name: 'My target',
          source: 'Me',
          rig: { family: 'bk5128', detail: 'Bruel & Kjaer 5128' },
        }),
      );
      expect(state?.targetId).toBe(state?.targets[0]?.id);
      expect(state?.targets[0]?.isTranslated).toBe(false);
    });

    it('remembers it all across a restart', async () => {
      const handlers = open();
      picked = fileOf('one.csv', CSV);
      await handlers['headphones.import'](measurementRequest);
      unwrap(handlers['headphones.setOption']({ bassDb: 4 }));
      const again = unwrap(open()['headphones.state']());
      expect(again.measurements).toHaveLength(1);
      expect(again.options.bassDb).toBe(4);
    });

    it('starts empty, and says so in the log, on a store it cannot read', async () => {
      const handlers = open();
      picked = fileOf('one.csv', CSV);
      await handlers['headphones.import'](measurementRequest);
      writeFileSync(join(dir, 'headphones.json'), '{ not json');
      expect(unwrap(open()['headphones.state']()).measurements).toEqual([]);
      expect(errors).toHaveLength(1);
    });

    it('takes away the curve with it on removal', async () => {
      const handlers = open();
      picked = fileOf('one.csv', CSV);
      const state = unwrap(await handlers['headphones.import'](measurementRequest));
      const id = state?.measurementId ?? 0;
      const after = unwrap(handlers['headphones.remove']({ kind: 'measurement', id }));
      expect(after.measurementId).toBeNull();
      expect(after.measurements).toEqual([]);
      expect(existsSync(join(dir, 'curves', `measurement-${id}.json`))).toBe(false);
    });

    it('refuses a selection of something gone', () => {
      expect(open()['headphones.select']({ measurementId: 99, targetId: null }).ok).toBe(false);
    });
  });

  describe('AutoEq', () => {
    it('asks for nothing until asked', () => {
      open();
      expect(asked).toEqual([]);
    });

    it('searches its index, and only fetches it the once', async () => {
      const handlers = open();
      const found = unwrap(await handlers['autoeq.search']({ query: 'acme' }));
      expect(found.total).toBe(2);
      await handlers['autoeq.search']({ query: 'one' });
      expect(asked).toHaveLength(1);
    });

    it('keeps the index for the next run', async () => {
      await open()['autoeq.search']({ query: 'acme' });
      asked = [];
      await open()['autoeq.search']({ query: 'acme' });
      expect(asked).toEqual([]);
    });

    it('says so when it can not be reached, and leaves nothing behind', async () => {
      down = true;
      const handlers = open();
      const result = await handlers['autoeq.search']({ query: 'acme' });
      expect(result.ok).toBe(false);
      down = false;
      expect(unwrap(await handlers['autoeq.search']({ query: 'acme' })).total).toBe(2);
    });

    async function fetched(name: string): Promise<{ handlers: ReturnType<typeof open>; state: HeadphoneState }> {
      const handlers = open();
      const found = unwrap(await handlers['autoeq.search']({ query: name }));
      const entryId = found.entries[0]?.id ?? 0;
      return { handlers, state: unwrap(await handlers['autoeq.fetch']({ entryId })) };
    }

    it('downloads a measurement and its preset, at the pinned commit, tagged with where they are from', async () => {
      const { handlers, state } = await fetched('Acme One');
      const measurement = state.measurements[0];
      expect(measurement).toMatchObject({
        headphone: 'Acme One',
        source: 'oratory1990',
        rig: { family: 'iec711-pinna', detail: 'GRAS 43AG' },
        origin: { kind: 'autoeq', commit: AUTOEQ_COMMIT },
        hasCurve: true,
        hasPreset: true,
      });
      expect(unwrap(handlers['headphones.curve']({ kind: 'measurement', id: measurement?.id ?? 0 }))?.hz).toHaveLength(
        8,
      );
      expect(asked.every((url) => url.startsWith(base))).toBe(true);
    });

    it("keeps a preset with no measurement as just that, and doesn't ask for what isn't public", async () => {
      const { handlers, state } = await fetched('Acme In');
      const measurement = state.measurements[0];
      expect(measurement).toMatchObject({ hasCurve: false, hasPreset: true });
      expect(asked.some((url) => url.includes('measurements/crinacle'))).toBe(false);
      expect(unwrap(handlers['headphones.curve']({ kind: 'measurement', id: measurement?.id ?? 0 }))).toBeNull();
      expect(errors).toEqual([]);
    });

    it('puts a preset on the EQ unsaved, keeping its preamp', async () => {
      const { handlers, state } = await fetched('Acme One');
      const result = unwrap(handlers['headphones.usePreset']({ measurementId: state.measurementId ?? 0 }));
      expect(result.clampedBands).toBe(0);
      expect(applied.at(-1)?.preamp).toEqual({ auto: false, db: -3.2 });
      expect(applied.at(-1)?.bands).toHaveLength(2);
      expect(settings.get().eqPreset).toBeNull();
      expect(settings.get().eqPresets).toEqual([]);
    });

    it('does not fetch twice what it already has', async () => {
      const { handlers, state } = await fetched('Acme One');
      asked = [];
      const found = unwrap(await handlers['autoeq.search']({ query: 'Acme One' }));
      const again = unwrap(await handlers['autoeq.fetch']({ entryId: found.entries[0]?.id ?? 0 }));
      expect(again.measurements).toHaveLength(1);
      expect(again.measurementId).toBe(state.measurementId);
      expect(asked).toEqual([]);
    });

    it('fetches every curve and keeps its place, skipping what is not a target', async () => {
      const handlers = open();
      const result = unwrap(await handlers['autoeq.fetchTargets']());
      expect(result).toMatchObject({ added: 2, updated: 0, failed: 0 });
      expect(result.state.targetId).toBeNull();
      expect(result.state.targetsFetchedAt).not.toBeNull();
      expect(result.state.targets.map(({ name }) => name)).toEqual(['Harman over-ear 2018', 'Some new curve']);
      expect(result.state.targets[0]).toMatchObject({
        rig: { family: 'iec711-pinna', detail: 'GRAS 45CA with a custom pinna' },
        origin: { kind: 'autoeq', commit: NEW_COMMIT },
      });
      expect(result.state.targets[1]).toMatchObject({ rig: { family: 'unknown' } });
    });

    it('downloads only what is new or changed on a refetch, and keeps what AutoEq dropped', async () => {
      const handlers = open();
      unwrap(await handlers['autoeq.fetchTargets']());
      asked = [];
      targetFiles = {
        ...TARGET_FILES,
        [`${API}/contents/targets?ref=${NEW_COMMIT}`]: listing([
          { name: 'Harman over-ear 2018.csv', sha: 'changed' },
          { name: 'Later curve.csv', sha: 'four' },
        ]),
        [`${raw}/targets/Later%20curve.csv`]: CSV,
      };
      const result = unwrap(await handlers['autoeq.fetchTargets']());
      expect(result).toMatchObject({ added: 1, updated: 1, failed: 0 });
      expect(asked.filter((url) => url.startsWith(raw))).toHaveLength(2);
      expect(result.state.targets.map(({ name }) => name)).toEqual([
        'Harman over-ear 2018',
        'Some new curve',
        'Later curve',
      ]);
    });

    it('keeps what it got and says how many it could not', async () => {
      targetFiles = { ...TARGET_FILES };
      delete targetFiles[`${raw}/targets/Some%20new%20curve.csv`];
      const result = unwrap(await open()['autoeq.fetchTargets']());
      expect(result).toMatchObject({ added: 1, failed: 1 });
      expect(result.state.targetsFetchedAt).not.toBeNull();
    });

    it('says so when it is offline, and loses nothing', async () => {
      const handlers = open();
      unwrap(await handlers['autoeq.fetchTargets']());
      down = true;
      expect((await handlers['autoeq.fetchTargets']()).ok).toBe(false);
      expect(unwrap(handlers['headphones.state']()).targets).toHaveLength(2);
    });
  });

  describe('the comparison', () => {
    it('goes to the matched off side, then back to exactly what was there', () => {
      const handlers = open();
      unwrap(handlers['headphones.compare']({ on: true, sampleRate: 44_100 }));
      const off = applied.at(-1);
      expect(off?.bands[0]?.gainDb).toBe(0);
      expect(off?.preamp.auto).toBe(false);
      expect(off?.preamp.db).toBeLessThan(0);
      unwrap(handlers['headphones.compare']({ on: false, sampleRate: 44_100 }));
      expect(applied.at(-1)).toEqual(SHAPED);
    });

    it('takes no notice of a second press, so it can never save the off side as the original', () => {
      const handlers = open();
      unwrap(handlers['headphones.compare']({ on: true, sampleRate: 44_100 }));
      unwrap(handlers['headphones.compare']({ on: true, sampleRate: 44_100 }));
      unwrap(handlers['headphones.compare']({ on: false, sampleRate: 44_100 }));
      expect(applied.at(-1)).toEqual(SHAPED);
      unwrap(handlers['headphones.compare']({ on: false, sampleRate: 44_100 }));
      expect(applied).toHaveLength(2);
    });

    it('refuses when there is nothing to compare', () => {
      settings.update({ eq: { ...SHAPED, enabled: false } });
      expect(open()['headphones.compare']({ on: true, sampleRate: 44_100 }).ok).toBe(false);
    });

    it('puts the real EQ back after dying in the middle of one', () => {
      const handlers = open();
      unwrap(handlers['headphones.compare']({ on: true, sampleRate: 44_100 }));
      const comparingOnDisk = () =>
        (JSON.parse(readFileSync(join(dir, 'headphones.json'), 'utf8')) as { comparing: unknown }).comparing;
      expect(comparingOnDisk()).toEqual(SHAPED);
      open();
      expect(applied.at(-1)).toEqual(SHAPED);
      expect(comparingOnDisk()).toBeNull();
    });
  });
});
