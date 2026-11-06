import type { PlaylistSummary } from '@shared/domain';

const LOCALE = 'en';

export const NOT_ON_THIS_DEVICE = 'Not on this device';

/** `0:00`, `3:07`, `1:02:09`. Hours are never capped, so a whole library's length still reads right. */
export function formatDuration(milliseconds: number): string {
  const total = Number.isFinite(milliseconds) && milliseconds > 0 ? Math.floor(milliseconds / 1000) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const seconds = String(total % 60).padStart(2, '0');

  if (hours === 0) return `${minutes}:${seconds}`;
  return `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`;
}

/** `0:10 / 3:39`, or nothing while there's no length to go by. */
export function formatElapsed(positionMs: number, durationMs: number): string {
  if (durationMs <= 0) return '';
  return `${formatDuration(Math.min(positionMs, durationMs))} / ${formatDuration(durationMs)}`;
}

/** `45 s`, `2 min 5 s`, `1 hr 2 min`. For how long something took, or how long an album runs. */
export function formatSpan(milliseconds: number): string {
  const total = Number.isFinite(milliseconds) && milliseconds > 0 ? Math.round(milliseconds / 1000) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const seconds = total % 60;

  if (hours > 0) return minutes > 0 ? `${hours} hr ${minutes} min` : `${hours} hr`;
  if (minutes > 0) return seconds > 0 ? `${minutes} min ${seconds} s` : `${minutes} min`;
  return `${seconds} s`;
}

export function formatCount(count: number): string {
  return count.toLocaleString(LOCALE);
}

/** `1 track`, `1,204 tracks`. */
export function formatPlural(count: number, one: string, many = `${one}s`): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`;
}

const dateTime = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short' });

/** `Oct 30, 2026, 6:02 PM`, in this machine's time. */
export function formatDateTime(timestamp: number): string {
  return dateTime.format(timestamp);
}

const day = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium' });

/** `Oct 30, 2026`, in this machine's time. */
export function formatDay(timestamp: number): string {
  return day.format(timestamp);
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** `512 B`, `4.5 MB`, `433 MB`. */
export function formatBytes(bytes: number): string {
  let value = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${BYTE_UNITS[unit]}`;
}

/** Joins what's there with a middle dot, leaving out what isn't. */
export function joinParts(...parts: (string | number | null)[]): string {
  return parts.filter((part) => part !== null && part !== '').join(' · ');
}

/** A playlist's small print: how many, how long, and how many of them aren't here. */
export function playlistMeta({ trackCount, durationMs, missingCount }: PlaylistSummary): string {
  return joinParts(
    formatPlural(trackCount, 'track'),
    durationMs > 0 ? formatSpan(durationMs) : null,
    missingCount > 0 ? `${missingCount} not on this device` : null,
  );
}
