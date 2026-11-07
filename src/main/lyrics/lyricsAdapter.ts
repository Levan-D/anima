/*
 * Lyrics from a service of the person's choosing, through a script of theirs. What it finds is judged the same way as an
 * LRCLIB record, so the words themselves have to hold up.
 */

import * as z from 'zod';
import { ok, type Result } from '@shared/result';
import { createScriptService, type ScriptRun } from '@main/online/scriptService';
import { lyricsFrom, type LrclibLyrics, type LrclibRecord, type LrclibTrack } from './lrclib';

// The same pace as LRCLIB's, since nothing says what another service allows.
const REQUEST_GAP_MS = 700;
const MAX_LYRICS_CHARS = 200_000;

/** A song any lyrics service should know, for a test. */
const SAMPLE: LrclibTrack = { title: 'Hello', artist: 'Adele', album: '25', durationMs: 295_000 };

const text = z
  .string()
  .max(MAX_LYRICS_CHARS)
  .nullish()
  .transform((value) => (value === undefined || value === null || value.trim() === '' ? null : value));

const lyricsSchema = z.strictObject({ plain: text, synced: text, instrumental: z.boolean().optional() });

type Deps = {
  /** The script, read at each song so an edit takes effect at once. */
  script: () => string | null;
  userAgent: string;
  run: ScriptRun;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

export function createLyricsAdapter(deps: Deps) {
  const service = createScriptService({ ...deps, gapMs: REQUEST_GAP_MS });

  async function lookup(track: LrclibTrack): Promise<Result<LrclibLyrics>> {
    const input = {
      title: track.title,
      artist: track.artist,
      album: track.album,
      durationSeconds: Math.round(track.durationMs / 1000),
    };
    const found = await service.answer(input, lyricsSchema);
    if (!found.ok) return found;
    if (found.value === null) return ok({ status: 'not_found' });

    const { plain, synced, instrumental = false } = found.value;
    // As if the service had sent a record for exactly this song, so only the words themselves are judged.
    const record: LrclibRecord = {
      id: 0,
      trackName: input.title,
      artistName: input.artist,
      albumName: input.album ?? '',
      duration: input.durationSeconds,
      instrumental,
      plainLyrics: plain,
      syncedLyrics: synced,
    };
    return ok(lyricsFrom(record, track, 'script'));
  }

  /** The script on a sample song, saying what it made of it. Never the words: only what kind of lyrics came back. */
  async function test(): Promise<Result<{ note: string }>> {
    const found = await lookup(SAMPLE);
    if (!found.ok) return found;
    const sample = `${SAMPLE.artist}, ${SAMPLE.title}`;
    switch (found.value.status) {
      case 'found':
        return ok({ note: `It found ${found.value.syncedLrc === null ? '' : 'timed '}lyrics for ${sample}` });
      case 'instrumental':
        return ok({ note: `It read the answer, which says ${sample} has no words` });
      case 'not_found':
        return ok({ note: `It read the answer, which has no lyrics for ${sample}` });
    }
  }

  return { lookup, test };
}
