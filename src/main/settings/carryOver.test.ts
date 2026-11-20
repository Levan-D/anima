import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { carryOverData } from '@main/settings/carryOver';

const TEMP_ROOT = resolve('.dev/test-tmp/carry-over');
const OLD = join(TEMP_ROOT, 'Music Player');
const NEW = join(TEMP_ROOT, 'anima');

function put(path: string, text: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
}

beforeEach(() => {
  rmSync(TEMP_ROOT, { recursive: true, force: true });
  put(join(OLD, 'settings.json'), '{"volume":40}');
  put(join(OLD, 'art-cache', 'ab.webp'), 'art');
  put(join(OLD, 'logs', 'main.log'), 'old log');
  put(join(NEW, 'Local State'), 'chromium');
});

afterAll(() => rmSync(TEMP_ROOT, { recursive: true, force: true }));

describe('carryOverData', () => {
  it('moves the settings and the art cache, and leaves the logs', () => {
    expect(carryOverData(OLD, NEW)).toEqual({ ok: true, value: ['settings.json', 'art-cache'] });
    expect(readFileSync(join(NEW, 'settings.json'), 'utf8')).toBe('{"volume":40}');
    expect(existsSync(join(NEW, 'art-cache', 'ab.webp'))).toBe(true);
    expect(existsSync(join(OLD, 'settings.json'))).toBe(false);
    expect(existsSync(join(OLD, 'logs', 'main.log'))).toBe(true);
    expect(existsSync(join(NEW, 'Local State'))).toBe(true);
  });

  it('does nothing once the new folder has settings', () => {
    put(join(NEW, 'settings.json'), '{"volume":90}');
    expect(carryOverData(OLD, NEW)).toEqual({ ok: true, value: [] });
    expect(readFileSync(join(NEW, 'settings.json'), 'utf8')).toBe('{"volume":90}');
    expect(existsSync(join(OLD, 'settings.json'))).toBe(true);
  });

  it('does nothing on a machine that never had the old name', () => {
    rmSync(OLD, { recursive: true });
    expect(carryOverData(OLD, NEW)).toEqual({ ok: true, value: [] });
  });

  it('keeps an art cache the new folder already has', () => {
    put(join(NEW, 'art-cache', 'cd.webp'), 'new art');
    expect(carryOverData(OLD, NEW)).toEqual({ ok: true, value: ['settings.json'] });
    expect(existsSync(join(NEW, 'art-cache', 'ab.webp'))).toBe(false);
  });
});
