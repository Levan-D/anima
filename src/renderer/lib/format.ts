/** `0:00`, `3:07`, `1:02:09`. Hours are never capped, so a whole library's length still reads right. */
export function formatDuration(milliseconds: number): string {
  const total = Number.isFinite(milliseconds) && milliseconds > 0 ? Math.floor(milliseconds / 1000) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const seconds = String(total % 60).padStart(2, '0');

  if (hours === 0) return `${minutes}:${seconds}`;
  return `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`;
}
