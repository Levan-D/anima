/* How long to wait before asking a web service again, for every service the app asks. */

const BACKOFF_MS = 2_000;
const DEFAULT_RETRY_AFTER_MS = 5_000;
const MAX_JITTER = 0.3;

function retryAfterMs(value: string | null, nowMs: number): number | null {
  if (value === null || value.trim() === '') return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - nowMs);
}

function baseDelayMs(status: number | null, retryAfter: string | null, attempt: number, nowMs: number): number | null {
  if (status === 429 || status === 503) return retryAfterMs(retryAfter, nowMs) ?? DEFAULT_RETRY_AFTER_MS;
  if (status === null || status >= 500) return BACKOFF_MS * 2 ** (attempt - 1);
  return null;
}

/** null means don't retry. A service can ban a client that ignores Retry-After, as LRCLIB says it does. */
export function retryDelayMs(
  status: number | null,
  retryAfter: string | null,
  attempt: number,
  nowMs: number,
  random: number,
): number | null {
  const delay = baseDelayMs(status, retryAfter, attempt, nowMs);
  return delay === null ? null : Math.round(delay * (1 + random * MAX_JITTER));
}
