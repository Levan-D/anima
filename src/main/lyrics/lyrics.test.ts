import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ONLINE_SERVICES_DEFAULT } from '@shared/onlineServices';
import { err, ok, type Result } from '@shared/result';
import { closeTestDatabase, openTestDatabase, tempDir } from '@main/library/testFixtures';
import type { Connection } from '@main/db/connection';
import type { Library } from '@main/library/library';
import type { LrclibLyrics } from './lrclib';
import { createLyrics } from './lyrics';
import { parseLrc } from './lrc';
import { embeddedLyrics, pickLyrics, readSidecar } from './sources';
import { decodeText } from '@main/system/decodeText';

const LONG_TEXT = 'plum pear quince apple fig date lime kiwi lemon melon mango peach grape berry cherry';
const match = { via: 'exact', id: 1, title: 't', artist: 'a', album: 'b', durationSeconds: 1 } as const;

const timed = parseLrc('[00:01.00]timed plum');
const plain = parseLrc('plain plum');

describe('pickLyrics', () => {
  const stored = (synced: string | null, text: string | null) =>
    ({ status: 'found', syncedLrc: synced, plainText: text }) as const;
  const none = { sidecar: null, stored: null, embedded: null, lookupFailed: false };

  it('takes a timed sidecar over all else', () => {
    const picked = pickLyrics({ ...none, sidecar: timed, stored: stored('[00:02.00]other', null), embedded: plain });
    expect(picked).toMatchObject({ source: 'sidecar', synced: [{ timeMs: 1_000 }] });
  });

  it('takes timed from the table over embedded plain', () => {
    const picked = pickLyrics({ ...none, stored: stored('[00:02.00]other', 'other'), embedded: plain });
    expect(picked).toMatchObject({ source: 'lrclib', synced: [{ timeMs: 2_000 }], plain: 'other' });
  });

  it('takes embedded plain over plain from the table', () => {
    const picked = pickLyrics({ ...none, stored: stored(null, 'other'), embedded: plain });
    expect(picked).toMatchObject({ source: 'embedded', synced: null, plain: 'plain plum' });
  });

  it('takes plain from the table with nothing else', () => {
    expect(pickLyrics({ ...none, stored: stored(null, '[00:01.00]other') })).toMatchObject({
      source: 'lrclib',
      synced: null,
      plain: 'other',
    });
  });

  it('lets embedded words beat a label that says there are none', () => {
    const instrumental = { status: 'instrumental', syncedLrc: null, plainText: null } as const;
    expect(pickLyrics({ ...none, stored: instrumental, embedded: plain })).toMatchObject({ source: 'embedded' });
    expect(pickLyrics({ ...none, stored: instrumental })).toEqual({ status: 'instrumental' });
  });

  it('says no lyrics, or none right now', () => {
    expect(pickLyrics(none)).toEqual({ status: 'none' });
    expect(pickLyrics({ ...none, lookupFailed: true })).toMatchObject({ status: 'unavailable' });
  });
});

describe('embedded text', () => {
  it("isn't lyrics under 15 words", () => {
    expect(embeddedLyrics(['plum pear quince'])).toBeNull();
    expect(embeddedLyrics(['plum', LONG_TEXT])?.plain).toBe(LONG_TEXT);
  });
});

describe('sidecar files', () => {
  it('decodes UTF-8 with or without a BOM, then windows-1252', () => {
    expect(decodeText(new TextEncoder().encode('\ufeffслива'))).toBe('слива');
    expect(decodeText(new TextEncoder().encode('слива'))).toBe('слива');
    expect(decodeText(Uint8Array.of(0x63, 0x61, 0x66, 0xe9))).toBe('café');
  });

  it('are found beside the audio, and null when there is none', async () => {
    const dir = tempDir('lyrics-sidecar');
    writeFileSync(join(dir, 'a.b.lrc'), '[00:01.00]plum');
    expect((await readSidecar(join(dir, 'a.b.flac')))?.synced).toEqual([{ timeMs: 1_000, text: 'plum' }]);
    expect(await readSidecar(join(dir, 'other.flac'))).toBeNull();
  });
});

describe('createLyrics', () => {
  const record = {
    id: 7,
    trackName: 'Pear',
    artistName: 'Plum',
    albumName: '',
    duration: 60,
    instrumental: false,
    plainLyrics: null,
    syncedLyrics: '[00:01.00]chosen plum',
  };
  let db: Connection;
  let trackId: number;
  let lookup: ReturnType<typeof vi.fn<() => Promise<Result<LrclibLyrics>>>>;
  let sidecar: ReturnType<typeof parseLrc> | null;
  let embedded: ReturnType<typeof parseLrc> | null;
  let fetchOnline: boolean;
  let lrclibOn: boolean;
  const emit = vi.fn();
  const markChanged = vi.fn();

  function lyrics(artist = 'Plum') {
    db.prepare('UPDATE artists SET name = ?').run(artist);
    const library = {
      perConnection: <Q>(create: (connection: Connection) => Q) => {
        const made = create(db);
        return <T>(work: (queries: Q) => T): Result<T> => ok(work(made));
      },
      markChanged,
      absolutePath: () => 'D:/nowhere/plum.flac',
      folder: () => 'D:/nowhere',
      storedInfo: () => ({ databasePath: 'library.db' }),
    } as unknown as Library;
    return createLyrics({
      library,
      settings: {
        get: () => ({
          fetchLyricsOnline: fetchOnline,
          onlineServices: { ...ONLINE_SERVICES_DEFAULT, lrclib: { isOn: lrclibOn, address: null } },
        }),
      },
      emit,
      log: { warn: () => {} },
      now: () => 5,
      lrclib: { lookup, search: () => Promise.resolve(ok([])), record: () => Promise.resolve(ok(record)) },
      pickFile: () => Promise.resolve(null),
      pickLyricsFile: () => Promise.resolve(null),
      runImport: () => Promise.resolve(err('unexpected', 'not used')),
      read: { sidecar: () => Promise.resolve(sidecar), embedded: () => Promise.resolve(embedded) },
    });
  }

  const row = () => db.prepare('SELECT status FROM lyrics WHERE track_id = ?').get(trackId);
  const found = (syncedLrc: string): Result<LrclibLyrics> => ok({ status: 'found', syncedLrc, plainText: null, match });

  beforeEach(() => {
    if (db?.open) closeTestDatabase(db);
    ({ db } = openTestDatabase(tempDir('lyrics')));
    db.exec(`
      INSERT INTO artists (id, name, sort_name) VALUES (1, 'Plum', 'plum');
      INSERT INTO files (id, rel_path, size_bytes, mtime_ms, codec, duration_ms, scanned_at)
        VALUES (1, 'plum.flac', 1, 1, 'FLAC', 60000, 1);
      INSERT INTO tracks (id, file_id, title, sort_title, artist_id) VALUES (9, 1, 'Pear', 'pear', 1);
    `);
    trackId = 9;
    lookup = vi.fn(() => Promise.resolve(found('[00:01.00]online plum')));
    sidecar = null;
    embedded = null;
    fetchOnline = true;
    lrclibOn = true;
    emit.mockClear();
    markChanged.mockClear();
  });

  it('puts a chosen record ahead of a timed sidecar, and clearing goes back to the sidecar', async () => {
    sidecar = parseLrc('[00:01.00]sidecar plum');
    const player = lyrics();
    await player.choose(trackId, 7);
    expect(await player.get(trackId)).toMatchObject({ ok: true, value: { source: 'chosen' } });

    player.clear(trackId);
    expect(await player.get(trackId)).toMatchObject({ ok: true, value: { source: 'sidecar' } });
  });

  it("doesn't let a lookup that was already running replace a choice", async () => {
    let answer: (result: Result<LrclibLyrics>) => void = () => {};
    lookup.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const player = lyrics();
    const asking = player.get(trackId);
    await vi.waitFor(() => expect(lookup).toHaveBeenCalled());

    await player.choose(trackId, 7);
    answer(found('[00:01.00]online plum'));
    expect(await asking).toMatchObject({ ok: true, value: { source: 'chosen' } });
  });

  it('asks LRCLIB once, and remembers what it said', async () => {
    const answers = lyrics();
    expect(await answers.get(trackId)).toMatchObject({
      value: { status: 'found', source: 'lrclib', synced: [{ text: 'online plum' }], offsetMs: 0 },
    });
    await answers.get(trackId);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(markChanged).toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith('library.changed', { scopes: ['lyrics'] });
  });

  it('remembers not_found and instrumental, until asked again', async () => {
    lookup.mockResolvedValueOnce(ok({ status: 'not_found' }));
    const answers = lyrics();
    expect(await answers.get(trackId)).toMatchObject({ value: { status: 'none' } });
    expect(row()).toEqual({ status: 'not_found' });
    await answers.get(trackId);
    expect(lookup).toHaveBeenCalledTimes(1);

    lookup.mockResolvedValueOnce(ok({ status: 'instrumental', match }));
    expect(await answers.refresh(trackId)).toMatchObject({ value: { status: 'instrumental' } });
    expect(await answers.get(trackId)).toMatchObject({ value: { status: 'instrumental' } });
    expect(lookup).toHaveBeenCalledTimes(2);

    expect(await answers.refresh(trackId)).toMatchObject({ value: { source: 'lrclib' } });
    expect(lookup).toHaveBeenCalledTimes(3);
  });

  it('is quiet about a failed lookup and tries again next time', async () => {
    lookup.mockResolvedValueOnce(err('network', 'offline'));
    const answers = lyrics();
    expect(await answers.get(trackId)).toMatchObject({ value: { status: 'unavailable' } });
    expect(row()).toBeUndefined();
    expect(await answers.get(trackId)).toMatchObject({ value: { status: 'found' } });
  });

  it('shows what it has when a lookup fails', async () => {
    lookup.mockResolvedValueOnce(err('network', 'offline'));
    embedded = plain;
    expect(await lyrics().get(trackId)).toMatchObject({ value: { source: 'embedded', plain: 'plain plum' } });
  });

  it('never asks with the setting off, or for an unknown artist', async () => {
    fetchOnline = false;
    expect(await lyrics().get(trackId)).toMatchObject({ value: { status: 'none' } });
    expect(await lyrics().refresh(trackId)).toMatchObject({ value: { status: 'none' } });
    fetchOnline = true;
    expect(await lyrics('Unknown Artist').get(trackId)).toMatchObject({ value: { status: 'none' } });
    expect(lookup).not.toHaveBeenCalled();
    expect(row()).toBeUndefined();
  });

  it('never asks LRCLIB once it is turned off, and Update says why it cannot run', async () => {
    lrclibOn = false;
    expect(await lyrics().get(trackId)).toMatchObject({ value: { status: 'none' } });
    expect(await lyrics().refresh(trackId)).toMatchObject({ value: { status: 'none' } });
    expect(lookup).not.toHaveBeenCalled();
    expect(lyrics().dataset.problem()).toBe('LRCLIB is turned off. Configure turns it back on');
    lrclibOn = true;
    expect(lyrics().dataset.problem()).toBeNull();
  });

  it("doesn't ask when a sidecar is timed", async () => {
    sidecar = timed;
    expect(await lyrics().get(trackId)).toMatchObject({ value: { source: 'sidecar' } });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("shows what's on the disk at once, while a slow lookup goes on behind it", async () => {
    let answer: (result: Result<LrclibLyrics>) => void = () => {};
    lookup.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    embedded = plain;
    const answers = lyrics();

    expect(await answers.get(trackId)).toMatchObject({ value: { source: 'embedded', plain: 'plain plum' } });
    expect(lookup).toHaveBeenCalledOnce();
    expect(emit).not.toHaveBeenCalled();

    answer(found('[00:01.00]online plum'));
    await vi.waitFor(() => expect(emit).toHaveBeenCalledWith('library.changed', { scopes: ['lyrics'] }));
    expect(await answers.get(trackId)).toMatchObject({ value: { source: 'lrclib' } });
  });

  it('waits for the answer when there is nothing on the disk', async () => {
    expect(await lyrics().get(trackId)).toMatchObject({ value: { source: 'lrclib' } });
  });

  it('survives a lookup behind the scenes that throws', async () => {
    lookup.mockRejectedValueOnce(new Error('boom'));
    embedded = plain;
    expect(await lyrics().get(trackId)).toMatchObject({ value: { source: 'embedded' } });
    await vi.waitFor(() => expect(lookup).toHaveBeenCalledOnce());
  });

  it('keeps found lyrics when asking again finds nothing', async () => {
    const answers = lyrics();
    await answers.get(trackId);
    lookup.mockResolvedValueOnce(ok({ status: 'not_found' }));
    expect(await answers.refresh(trackId)).toMatchObject({ value: { source: 'lrclib' } });
  });

  it('says so for a track that is not there', async () => {
    expect(await lyrics().get(404)).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  describe('the nudge', () => {
    it('is stored per track, whatever the source, and zero leaves no row', async () => {
      sidecar = timed;
      const answers = lyrics();
      expect(answers.setOffset(trackId, -500)).toEqual({ ok: true, value: undefined });
      expect(await answers.get(trackId)).toMatchObject({ value: { source: 'sidecar', offsetMs: -500 } });

      answers.setOffset(trackId, 1_000);
      expect(await answers.get(trackId)).toMatchObject({ value: { offsetMs: 1_000 } });

      answers.setOffset(trackId, 0);
      expect(await answers.get(trackId)).toMatchObject({ value: { offsetMs: 0 } });
      expect(db.prepare('SELECT count(*) AS n FROM lyrics_offsets').get()).toEqual({ n: 0 });
      expect(emit).toHaveBeenCalledWith('library.changed', { scopes: ['lyrics'] });
    });

    it('goes when fetched lyrics are refreshed, and stays when nothing new came', async () => {
      const answers = lyrics();
      await answers.get(trackId);
      answers.setOffset(trackId, 500);

      lookup.mockResolvedValueOnce(ok({ status: 'not_found' }));
      expect(await answers.refresh(trackId)).toMatchObject({ value: { offsetMs: 500 } });

      lookup.mockResolvedValueOnce(found('[00:03.00]new plum'));
      expect(await answers.refresh(trackId)).toMatchObject({ value: { offsetMs: 0, synced: [{ timeMs: 3_000 }] } });
    });

    it('goes with its track', () => {
      const answers = lyrics();
      answers.setOffset(trackId, 500);
      db.prepare('DELETE FROM tracks WHERE id = ?').run(trackId);
      expect(db.prepare('SELECT count(*) AS n FROM lyrics_offsets').get()).toEqual({ n: 0 });
    });

    it('does nothing for a track that is gone', () => {
      lyrics().setOffset(404, 500);
      expect(db.prepare('SELECT count(*) AS n FROM lyrics_offsets').get()).toEqual({ n: 0 });
    });
  });
});
