import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { UI_SCALE_MAX, UI_SCALE_MIN } from '@shared/domain';
import { DEFAULT_SETTINGS, openSettings } from '@main/settings/settings';

const TEMP_ROOT = resolve('.dev/test-tmp/settings');

let dir: string;
let path: string;

beforeAll(() => mkdirSync(TEMP_ROOT, { recursive: true }));
afterAll(() => rmSync(TEMP_ROOT, { recursive: true, force: true }));

beforeEach(() => {
  dir = mkdtempSync(join(TEMP_ROOT, 'settings-'));
  path = join(dir, 'settings.json');
});

afterEach(() => {
  vi.useRealTimers();
});

const saved = () => JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;

describe('an EQ saved under older limits', () => {
  it('comes down to what is allowed, and gets an automatic preamp', () => {
    const band = { id: 1, kind: 'peak', frequencyHz: 100, gainDb: 20, q: 1 };
    writeFileSync(
      path,
      JSON.stringify({
        eq: { enabled: true, bands: [band] },
        eqPresets: [{ name: 'Old', bands: [{ ...band, gainDb: -24 }], preamp: { auto: false, db: 40 } }],
      }),
    );
    const { eq, eqPresets } = openSettings(path).get();
    expect(eq.bands[0]?.gainDb).toBe(12);
    expect(eq.preamp).toEqual({ auto: true, db: 0 });
    expect(eqPresets[0]?.bands[0]?.gainDb).toBe(-12);
    expect(eqPresets[0]?.preamp).toEqual({ auto: false, db: 6 });
  });
});

describe('defaults', () => {
  it('match what a fresh install should start with', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      libraryFolder: null,
      volume: 100,
      muted: false,
      outputMode: 'shared',
      replayGainMode: 'album',
      eq: { enabled: false, bands: [], preamp: { auto: true, db: 0 } },
      uiScale: 1,
      fetchLyricsOnline: true,
    });
  });

  it('are used when there is no file', () => {
    const errors = vi.fn();
    expect(openSettings(path, { onError: errors }).get()).toEqual(DEFAULT_SETTINGS);
    expect(errors).not.toHaveBeenCalled();
  });
});

describe('a bad file', () => {
  it('survives corrupt JSON, backing the file up as .bad', () => {
    writeFileSync(path, '{ "volume": 50, oops');
    const errors = vi.fn();

    const store = openSettings(path, { onError: errors });

    expect(store.get()).toEqual(DEFAULT_SETTINGS);
    expect(readFileSync(`${path}.bad`, 'utf8')).toBe('{ "volume": 50, oops');
    expect(existsSync(path)).toBe(false);
    expect(errors).toHaveBeenCalledOnce();
  });

  it.each(['null', '[1, 2]', '"text"', '7', ''])('survives a file containing %j', (content) => {
    writeFileSync(path, content);
    expect(openSettings(path).get()).toEqual(DEFAULT_SETTINGS);
    expect(existsSync(`${path}.bad`)).toBe(true);
  });

  it('never throws, even when the backup fails', () => {
    mkdirSync(`${path}.bad`);
    writeFileSync(join(`${path}.bad`, 'blocker'), 'a folder in the way');
    writeFileSync(path, 'not json');
    const errors = vi.fn();

    expect(openSettings(path, { onError: errors }).get()).toEqual(DEFAULT_SETTINGS);
    expect(errors).toHaveBeenCalledTimes(2);
  });

  it('keeps the good fields and defaults only the bad ones', () => {
    writeFileSync(path, JSON.stringify({ volume: 40, muted: 'yes', uiScale: 'big', outputMode: 'loud', extra: true }));

    const settings = openSettings(path).get();

    expect(settings).toEqual({ ...DEFAULT_SETTINGS, volume: 40 });
    expect(existsSync(`${path}.bad`)).toBe(false);
  });

  it('keeps a size saved outside the range as close as the range allows', () => {
    writeFileSync(path, JSON.stringify({ uiScale: 2.5 }));
    expect(openSettings(path).get().uiScale).toBe(UI_SCALE_MAX);
    writeFileSync(path, JSON.stringify({ uiScale: 0.1 }));
    expect(openSettings(path).get().uiScale).toBe(UI_SCALE_MIN);
  });

  it('reads a file that Notepad saved with a BOM', () => {
    const byteOrderMark = String.fromCharCode(0xfeff);
    writeFileSync(path, `${byteOrderMark}${JSON.stringify({ volume: 40 })}`);
    expect(openSettings(path).get().volume).toBe(40);
  });
});

describe('saving', () => {
  it('writes atomically, leaving no temp file behind', () => {
    const store = openSettings(path);
    store.update({ volume: 30 });
    store.flush();

    expect(saved()).toMatchObject({ volume: 30 });
    expect(readdirSync(dir)).toEqual(['settings.json']);
  });

  it('keeps the old file intact if the write fails', () => {
    writeFileSync(path, JSON.stringify({ volume: 10 }));
    mkdirSync(`${path}.tmp`);
    const errors = vi.fn();
    const store = openSettings(path, { onError: errors });

    store.update({ volume: 90 });
    store.flush();

    expect(saved()).toEqual({ volume: 10 });
    expect(errors).toHaveBeenCalledOnce();
    expect(store.get().volume).toBe(90);
  });

  it('debounces, so a burst of changes is one write', () => {
    vi.useFakeTimers();
    const store = openSettings(path, { debounceMs: 300 });

    store.update({ volume: 1 });
    vi.advanceTimersByTime(200);
    store.update({ volume: 2 });
    vi.advanceTimersByTime(200);
    expect(existsSync(path)).toBe(false);

    vi.advanceTimersByTime(100);
    expect(saved()).toMatchObject({ volume: 2 });
  });

  it('round-trips through a new store', () => {
    const store = openSettings(path);
    store.update({ uiScale: 1.5, muted: true });
    store.flush();

    expect(openSettings(path).get()).toEqual({ ...DEFAULT_SETTINGS, uiScale: 1.5, muted: true });
  });

  it('flush does nothing when there is nothing to write', () => {
    openSettings(path).flush();
    expect(existsSync(path)).toBe(false);
  });
});

describe('updates', () => {
  it('leave the other keys alone', () => {
    const store = openSettings(path);
    store.update({ uiScale: 2 });
    expect(store.update({ muted: true })).toMatchObject({ uiScale: 2, muted: true });
  });

  it('tell listeners', () => {
    const store = openSettings(path);
    const listener = vi.fn();
    store.onChange(listener);

    store.update({ volume: 12 });

    expect(listener).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, volume: 12 });
  });
});

describe('window bounds', () => {
  const bounds = { x: 10, y: 20, width: 800, height: 600, isMaximized: false };

  it('persist, but stay out of what the renderer sees', () => {
    const store = openSettings(path);
    store.setWindowBounds(bounds);
    store.flush();

    expect(saved().windowBounds).toEqual(bounds);
    expect(store.get()).not.toHaveProperty('windowBounds');
    expect(openSettings(path).windowBounds()).toEqual(bounds);
  });

  it('fall back to null when they are nonsense', () => {
    writeFileSync(path, JSON.stringify({ windowBounds: { x: 'left' } }));
    expect(openSettings(path).windowBounds()).toBeNull();
  });
});
