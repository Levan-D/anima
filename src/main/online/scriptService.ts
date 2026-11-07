/*
 * A service of the person's choosing, asked through a script of theirs: `request(item)` says where to ask, and
 * `parse(reply, item, ask)` reads the answer, or says where to ask next. The script runs sealed in the sandbox; this does
 * the asking, at the addresses it gives, and checks everything it hands back before anyone uses it.
 */

import { setTimeout as wait } from 'node:timers/promises';
import * as z from 'zod';
import { checkRequestUrl, SCRIPT_MAX_ASKS, SCRIPT_TIME_MS } from '@shared/onlineServices';
import { err, errorText, ok, type Result } from '@shared/result';
import { readCappedText } from '@main/system/cappedText';

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_REPLY_BYTES = 4 * 1024 * 1024;
const MAX_BODY_CHARS = 100_000;
// The app says who it is, and the rest are the connection's own.
const HEADERS_NOT_ALLOWED = new Set([
  'host',
  'cookie',
  'user-agent',
  'content-length',
  'connection',
  'transfer-encoding',
]);

const requestSchema = z.strictObject({
  url: z.string().max(4_000),
  method: z.enum(['GET', 'POST']).optional(),
  body: z.string().max(MAX_BODY_CHARS).optional(),
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

const nothingOrNext = z.union([z.null(), z.strictObject({ next: requestSchema })]);

export type ScriptRun = (call: {
  script: string;
  name: string;
  args: readonly unknown[];
  timeoutMs: number;
}) => Promise<Result<unknown>>;

type Deps = {
  /** Read at each item, so an edit takes effect at once. */
  script: () => string | null;
  userAgent: string;
  run: ScriptRun;
  /** Between requests, since nothing says what the service allows. */
  gapMs: number;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

function problemIn(name: string, error: z.ZodError): string {
  const issue = error.issues[0];
  const where = issue === undefined || issue.path.length === 0 ? '' : ` at ${issue.path.join('.')}`;
  return `${name} gave back something the app can't use${where}: ${issue?.message ?? 'not the right shape'}`;
}

export function createScriptService({
  script,
  userAgent,
  run,
  gapMs,
  fetch: send = (url, init) => fetch(url, init),
  sleep = (ms) => wait(ms),
  now = () => Date.now(),
}: Deps) {
  let nextRequestAt = 0;

  async function takeTurn(): Promise<void> {
    const startAt = Math.max(now(), nextRequestAt);
    nextRequestAt = startAt + gapMs;
    if (startAt > now()) await sleep(startAt - now());
  }

  async function call(code: string, name: string, args: readonly unknown[]): Promise<Result<unknown>> {
    return run({ script: code, name, args, timeoutMs: SCRIPT_TIME_MS });
  }

  async function ask({
    url,
    method = 'GET',
    body,
    headers = {},
  }: Ask): Promise<Result<{ status: number; body: string }>> {
    const checked = checkRequestUrl(url);
    if (!checked.ok) return err('script_failed', `request asked for ${url.slice(0, 200)}: ${checked.error.message}`);
    const host = new URL(checked.value).host;
    await takeTurn();
    try {
      const response = await send(checked.value, {
        method,
        ...(body === undefined ? {} : { body }),
        headers: { ...headers, 'User-Agent': userAgent },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: 'error',
      });
      const text = await readCappedText(response, MAX_REPLY_BYTES);
      if (text === null) return err('network', `${host} sent far more than an answer`);
      return ok({ status: response.status, body: text });
    } catch (error) {
      return err('network', `Couldn't reach ${host}: ${errorText(error)}`);
    }
  }

  /**
   * What the script makes of one item: null when the service knows nothing of it, or what `parse` gave back, checked
   * with `found`. It asks again wherever `parse` says next, up to the limit.
   */
  async function answer<Found extends z.ZodType>(item: unknown, found: Found): Promise<Result<z.output<Found> | null>> {
    const code = script();
    if (code === null) return err('script_failed', 'There is no script to ask with');

    const first = await call(code, 'request', [item]);
    if (!first.ok) return first;
    const firstAsk = requestSchema.safeParse(first.value);
    if (!firstAsk.success) return err('script_failed', problemIn('request', firstAsk.error));

    let next: Ask = firstAsk.data;
    for (let asked = 1; asked <= SCRIPT_MAX_ASKS; asked += 1) {
      const reply = await ask(next);
      if (!reply.ok) return reply;
      const parsed = await call(code, 'parse', [reply.value, item, asked]);
      if (!parsed.ok) return parsed;
      const moving = nothingOrNext.safeParse(parsed.value);
      if (moving.success) {
        if (moving.data === null) return ok(null);
        next = moving.data.next;
        continue;
      }
      const read = found.safeParse(parsed.value);
      return read.success ? ok(read.data) : err('script_failed', problemIn('parse', read.error));
    }
    return err('script_failed', `Your script asked more than ${SCRIPT_MAX_ASKS} times for one item`);
  }

  return { answer };
}
