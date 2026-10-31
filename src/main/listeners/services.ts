/*
 * What ListenBrainz and MusicBrainz expect from a client, and how to read what they say. Only names and the ids those names
 * turned out to have go out. Each service has its own pacing, because each has its own limit of one request a second.
 * The endpoints and what they can't do without an account are in docs/research/recommendations.md.
 */

import { setTimeout as wait } from 'node:timers/promises';
import * as z from 'zod';
import { err, errorText, ok, type Result } from '@shared/result';
import { artistKey, baseTitle, titleKey } from '@main/library/names';
import { retryDelayMs } from '@main/lyrics/lrclib';

const MUSICBRAINZ_URL = 'https://musicbrainz.org/ws/2';
const LISTENBRAINZ_LABS_URL = 'https://labs.api.listenbrainz.org';
// The endpoint refuses anything but its list of datasets, and answers 400 if this one is ever retired.
const ALGORITHM = 'session_based_days_9000_session_300_contribution_5_threshold_15_limit_50_skip_30';
const REQUEST_TIMEOUT_MS = 30_000;
const REQUEST_GAP_MS = 1_100;
const MAX_ATTEMPTS = 5;
const MAX_RECORDINGS = 25;

export const LISTENBRAINZ = 'listenbrainz';

const artistSearchSchema = z.object({
  artists: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      score: z.number().catch(0),
      aliases: z
        .array(z.object({ name: z.string() }))
        .nullish()
        .transform((aliases) => aliases ?? []),
    }),
  ),
});

const recordingSearchSchema = z.object({
  recordings: z.array(z.object({ id: z.string(), title: z.string() })),
});

// Either list can hold a row with no name, for an id MusicBrainz has since merged away.
const similarArtistsSchema = z.array(z.object({ name: z.string().nullable(), score: z.number() }));

const similarRecordingsSchema = z.array(
  z.object({ recording_name: z.string().nullable(), artist_credit_name: z.string().nullable(), score: z.number() }),
);

export type SimilarArtist = { name: string; score: number };
export type SimilarTrack = { artist: string; title: string; score: number };

type ServiceDeps = {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  random: () => number;
};

function escapeForSearch(text: string): string {
  return text.replace(/([+\-&|!(){}[\]^"~*?:\\/])/g, '\\$1');
}

/** Tags are trusted over a guess: a name that only looks close is someone else, and no answer is better than theirs. */
export function pickArtistId(name: string, artists: z.infer<typeof artistSearchSchema>['artists']): string | null {
  const key = artistKey(name);
  const byName = artists.find((artist) => artistKey(artist.name) === key);
  const byAlias = artists.find(({ aliases }) => aliases.some((alias) => artistKey(alias.name) === key));
  return (byName ?? byAlias)?.id ?? null;
}

export function pickRecordingIds(
  title: string,
  recordings: z.infer<typeof recordingSearchSchema>['recordings'],
): string[] {
  const key = titleKey(title);
  return recordings.filter((recording) => titleKey(recording.title) === key).map(({ id }) => id);
}

export function createServiceClient(userAgent: string, overrides: Partial<ServiceDeps> = {}) {
  const {
    fetch: send,
    sleep,
    now,
    random,
  }: ServiceDeps = {
    fetch: (url, init) => fetch(url, init),
    sleep: (ms) => wait(ms),
    now: () => Date.now(),
    random: () => Math.random(),
    ...overrides,
  };

  function paced() {
    let nextAt = 0;
    return async () => {
      const startAt = Math.max(now(), nextAt);
      nextAt = startAt + REQUEST_GAP_MS;
      if (startAt > now()) await sleep(startAt - now());
    };
  }
  const musicbrainzTurn = paced();
  const listenbrainzTurn = paced();

  async function ask(takeTurn: () => Promise<void>, url: string, init: RequestInit = {}): Promise<Result<unknown>> {
    for (let attempt = 1; ; attempt += 1) {
      await takeTurn();
      let status: number | null = null;
      let retryAfter: string | null = null;
      let message: string;
      try {
        const response = await send(url, {
          ...init,
          headers: { 'User-Agent': userAgent, Accept: 'application/json', ...init.headers },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (response.ok) return ok(await response.json());
        await response.body?.cancel();
        if (response.status === 404) return ok(null);
        status = response.status;
        retryAfter = response.headers.get('Retry-After') ?? response.headers.get('X-RateLimit-Reset-In');
        message = `${new URL(url).host} answered ${response.status}`;
      } catch (error) {
        message = `Couldn't reach ${new URL(url).host}: ${errorText(error)}`;
      }
      const delay = retryDelayMs(status, retryAfter, attempt, now(), random());
      if (delay === null || attempt === MAX_ATTEMPTS) return err(status === 429 ? 'rate_limited' : 'network', message);
      await sleep(delay);
    }
  }

  function parsed<S extends z.ZodType>(schema: S, answer: Result<unknown>): Result<z.output<S> | null> {
    if (!answer.ok) return answer;
    if (answer.value === null) return ok(null);
    const read = schema.safeParse(answer.value);
    return read.success ? ok(read.data) : err('network', 'A listener data service sent something unreadable');
  }

  return {
    /** Null when MusicBrainz has nobody by that name. */
    async artistId(name: string): Promise<Result<string | null>> {
      const quoted = escapeForSearch(name);
      const query = encodeURIComponent(`artist:"${quoted}" OR alias:"${quoted}"`);
      const answer = parsed(
        artistSearchSchema,
        await ask(musicbrainzTurn, `${MUSICBRAINZ_URL}/artist/?query=${query}&fmt=json&limit=10`),
      );
      if (!answer.ok) return answer;
      return ok(answer.value === null ? null : pickArtistId(name, answer.value.artists));
    },

    async similarArtists(artistMbid: string): Promise<Result<SimilarArtist[]>> {
      const answer = parsed(
        similarArtistsSchema,
        await ask(
          listenbrainzTurn,
          `${LISTENBRAINZ_LABS_URL}/similar-artists/json?artist_mbids=${artistMbid}&algorithm=${ALGORITHM}`,
        ),
      );
      if (!answer.ok) return answer;
      return ok((answer.value ?? []).flatMap(({ name, score }) => (name === null ? [] : [{ name, score }])));
    },

    /** The same song has many recordings, and listeners tend to have heard only some, so this takes them all. */
    async recordingIds(artist: string, title: string): Promise<Result<string[]>> {
      const query = encodeURIComponent(
        `recording:"${escapeForSearch(baseTitle(title))}" AND artist:"${escapeForSearch(artist)}"`,
      );
      const answer = parsed(
        recordingSearchSchema,
        await ask(musicbrainzTurn, `${MUSICBRAINZ_URL}/recording/?query=${query}&fmt=json&limit=${MAX_RECORDINGS}`),
      );
      if (!answer.ok) return answer;
      return ok(answer.value === null ? [] : pickRecordingIds(title, answer.value.recordings));
    },

    async similarTracks(recordingMbids: string[]): Promise<Result<SimilarTrack[]>> {
      const answer = parsed(
        similarRecordingsSchema,
        await ask(listenbrainzTurn, `${LISTENBRAINZ_LABS_URL}/similar-recordings/json`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([{ recording_mbids: recordingMbids, algorithm: ALGORITHM }]),
        }),
      );
      if (!answer.ok) return answer;
      return ok(
        (answer.value ?? []).flatMap(({ recording_name: title, artist_credit_name: artist, score }) =>
          title === null || artist === null ? [] : [{ artist, title, score }],
        ),
      );
    },
  };
}

export type ServiceClient = ReturnType<typeof createServiceClient>;
