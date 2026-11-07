/*
 * Lyrics from a service of the person's choosing, through a script of theirs that says how to ask it and how to read
 * what it answers. The script runs sealed in the sandbox; the app does the asking, at the addresses it gives, and checks
 * everything it hands back. What it finds is judged the same way as an LRCLIB record.
 */

import { setTimeout as wait } from 'node:timers/promises';
import * as z from 'zod';
import { checkRequestUrl, SCRIPT_MAX_ASKS, SCRIPT_TIME_MS } from '@shared/onlineServices';
import { err, errorText, ok, type Result } from '@shared/result';
import { readCappedText } from '@main/system/cappedText';
import { lyricsFrom, type LrclibLyrics, type LrclibRecord, type LrclibTrack } from './lrclib';

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_REPLY_BYTES = 4 * 1024 * 1024;
// The same pace as LRCLIB's, since nothing says what another service allows.
const REQUEST_GAP_MS = 700;
const MAX_LYRICS_CHARS = 200_000;
// The app says who it is, and the rest are the connection's own.
const HEADERS_NOT_ALLOWED = new Set([
  'host',
  'cookie',
  'user-agent',
  'content-length',
  'connection',
  'transfer-encoding',
]);

/** A song any lyrics service should know, for a test. */
const SAMPLE: LrclibTrack = { title: 'Hello', artist: 'Adele', album: '25', durationMs: 295_000 };

const requestSchema = z.strictObject({
  url: z.string().max(4_000),
  headers: z
    .record(
      z
        .string()
        .regex(/^[A-Za-z0-9-]{1,64}$/)
        .refine((name) => !HEADERS_NOT_ALLOWED.has(name.toLowerCase()), 'is set by the app'),
      z.string().max(1_000),
    )
    .refine((headers) => Object.keys(headers).length <= 10, 'are more than 10')
    .optional(),
});

type Ask = z.infer<typeof requestSchema>;

const text = z
  .string()
  .max(MAX_LYRICS_CHARS)
  .nullish()
  .transform((value) => (value === undefined || value === null || value.trim() === '' ? null : value));

const answerSchema = z.union([
  z.null(),
  z.strictObject({ next: requestSchema }),
  z.strictObject({ plain: text, synced: text, instrumental: z.boolean().optional() }),
]);

type Input = { title: string; artist: string; album: string | null; durationSeconds: number };

type Deps = {
  /** The script, read at each song so an edit takes effect at once. */
  script: () => string | null;
  userAgent: string;
  run: (call: {
    script: string;
    name: string;
    args: readonly unknown[];
    timeoutMs: number;
  }) => Promise<Result<unknown>>;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

function problemIn(name: string, error: z.ZodError): string {
  const issue = error.issues[0];
  const where = issue === undefined || issue.path.length === 0 ? '' : ` at ${issue.path.join('.')}`;
  return `${name} gave back something the app can't use${where}: ${issue?.message ?? 'not the right shape'}`;
}

export function createLyricsAdapter({
  script,
  userAgent,
  run,
  fetch: send = (url, init) => fetch(url, init),
  sleep = (ms) => wait(ms),
  now = () => Date.now(),
}: Deps) {
  let nextRequestAt = 0;

  async function takeTurn(): Promise<void> {
    const startAt = Math.max(now(), nextRequestAt);
    nextRequestAt = startAt + REQUEST_GAP_MS;
    if (startAt > now()) await sleep(startAt - now());
  }

  async function call<S extends z.ZodType>(
    code: string,
    name: string,
    args: readonly unknown[],
    schema: S,
  ): Promise<Result<z.output<S>>> {
    const answer = await run({ script: code, name, args, timeoutMs: SCRIPT_TIME_MS });
    if (!answer.ok) return answer;
    const read = schema.safeParse(answer.value);
    return read.success ? ok(read.data) : err('script_failed', problemIn(name, read.error));
  }

  async function ask({ url, headers = {} }: Ask): Promise<Result<{ status: number; body: string }>> {
    const checked = checkRequestUrl(url);
    if (!checked.ok) return err('script_failed', `request asked for ${url.slice(0, 200)}: ${checked.error.message}`);
    const host = new URL(checked.value).host;
    await takeTurn();
    try {
      const response = await send(checked.value, {
        headers: { ...headers, 'User-Agent': userAgent },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: 'error',
      });
      const body = await readCappedText(response, MAX_REPLY_BYTES);
      if (body === null) return err('network', `${host} sent far more than an answer`);
      return ok({ status: response.status, body });
    } catch (error) {
      return err('network', `Couldn't reach ${host}: ${errorText(error)}`);
    }
  }

  async function lookup(track: LrclibTrack): Promise<Result<LrclibLyrics>> {
    const code = script();
    if (code === null) return err('script_failed', 'There is no script to look lyrics up with');
    const input: Input = {
      title: track.title,
      artist: track.artist,
      album: track.album,
      durationSeconds: Math.round(track.durationMs / 1000),
    };

    const first = await call(code, 'request', [input], requestSchema);
    if (!first.ok) return first;
    let next: Ask = first.value;
    for (let asked = 1; asked <= SCRIPT_MAX_ASKS; asked += 1) {
      const reply = await ask(next);
      if (!reply.ok) return reply;
      const answer = await call(code, 'parse', [reply.value, input, asked], answerSchema);
      if (!answer.ok) return answer;
      if (answer.value === null) return ok({ status: 'not_found' });
      if ('next' in answer.value) {
        next = answer.value.next;
        continue;
      }
      const { plain, synced, instrumental = false } = answer.value;
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
    return err('script_failed', `Your script asked more than ${SCRIPT_MAX_ASKS} times for one song`);
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

export type LyricsAdapter = ReturnType<typeof createLyricsAdapter>;
