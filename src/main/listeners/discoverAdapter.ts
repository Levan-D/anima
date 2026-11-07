/*
 * Discover data from a service of the person's choosing, through a script of theirs, in place of the MusicBrainz and
 * ListenBrainz pair. It hands back the same lists those do: who else people play, by name, with a score.
 */

import * as z from 'zod';
import { ok, type Result } from '@shared/result';
import { createScriptService, type ScriptRun } from '@main/online/scriptService';
import type { SimilarArtist, SimilarTrack } from './services';

// MusicBrainz allows one request a second, the strictest of the services this stands in for.
const REQUEST_GAP_MS = 1_100;
const MAX_SIMILAR = 500;
const SAMPLE_ARTIST = 'Radiohead';

const name = z.string().trim().min(1).max(500);
const score = z.number().finite().nonnegative();

const artistsSchema = z.strictObject({
  similar: z.array(z.object({ artist: name, score })).max(MAX_SIMILAR),
});

const songsSchema = z.strictObject({
  similar: z.array(z.object({ artist: name, title: name, score })).max(MAX_SIMILAR),
});

type Deps = {
  /** The script, read at each item so an edit takes effect at once. */
  script: () => string | null;
  userAgent: string;
  run: ScriptRun;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

export function createDiscoverAdapter(deps: Deps) {
  const service = createScriptService({ ...deps, gapMs: REQUEST_GAP_MS });

  async function similarArtists(artist: string): Promise<Result<SimilarArtist[]>> {
    const found = await service.answer({ kind: 'artist', artist }, artistsSchema);
    if (!found.ok) return found;
    return ok((found.value?.similar ?? []).map((target) => ({ name: target.artist, score: target.score })));
  }

  async function similarTracks(artist: string, title: string): Promise<Result<SimilarTrack[]>> {
    const found = await service.answer({ kind: 'song', artist, title }, songsSchema);
    if (!found.ok) return found;
    return ok(found.value?.similar ?? []);
  }

  /** The script on one well-known artist, saying how many it found like them. */
  async function test(): Promise<Result<{ note: string }>> {
    const found = await similarArtists(SAMPLE_ARTIST);
    if (!found.ok) return found;
    const count = found.value.length;
    if (count === 0) return ok({ note: `It read the answer, which knows no artists like ${SAMPLE_ARTIST}` });
    return ok({ note: `It found ${count} artist${count === 1 ? '' : 's'} like ${SAMPLE_ARTIST}` });
  }

  return { similarArtists, similarTracks, test };
}

export type DiscoverAdapter = ReturnType<typeof createDiscoverAdapter>;
