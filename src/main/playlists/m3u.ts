/*
 * Playlists as .m3u8, the one format every player reads: foobar2000, VLC, Windows Media Player. UTF-8, a line per file,
 * with #EXTINF lines carrying the length and "Artist - Title" so a reader can still find a song that has moved. A CUE
 * track can only point at its whole file, since the format has no way to say where in it the track starts.
 */

import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type M3uTrack = { path: string; seconds: number; artist: string; title: string };
export type M3uEntry = { path: string; artist: string | null; title: string | null };

const oneLine = (text: string) => text.replace(/[\r\n]+/g, ' ').trim();

export function writeM3u(name: string, tracks: readonly M3uTrack[]): string {
  const lines = ['#EXTM3U', `#PLAYLIST:${oneLine(name)}`];
  for (const { path, seconds, artist, title } of tracks) {
    lines.push(`#EXTINF:${Math.round(seconds)},${oneLine(artist)} - ${oneLine(title)}`, path);
  }
  return `${lines.join('\r\n')}\r\n`;
}

function hintOf(extinf: string): { artist: string | null; title: string | null } {
  const comma = extinf.indexOf(',');
  const words = comma < 0 ? '' : extinf.slice(comma + 1).trim();
  const dash = words.indexOf(' - ');
  if (dash < 0) return { artist: null, title: words === '' ? null : words };
  return { artist: words.slice(0, dash).trim() || null, title: words.slice(dash + 3).trim() || null };
}

function pathOf(line: string, baseDir: string): string | null {
  if (/^file:/i.test(line)) {
    try {
      return fileURLToPath(line);
    } catch {
      return null;
    }
  }
  // A stream or anything else with a scheme can't be in the library.
  if (/^[a-z][a-z0-9+.-]+:\/\//i.test(line)) return null;
  return isAbsolute(line) ? line : resolve(baseDir, line);
}

/** Paths come back absolute, relative ones resolved against the playlist's own folder, as players do. */
export function readM3u(text: string, baseDir: string): { name: string | null; entries: M3uEntry[] } {
  let name: string | null = null;
  let hint: { artist: string | null; title: string | null } | null = null;
  const entries: M3uEntry[] = [];
  for (const raw of text.trimStart().split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;
    if (line.startsWith('#PLAYLIST:')) {
      name = line.slice('#PLAYLIST:'.length).trim() || null;
    } else if (line.startsWith('#EXTINF:')) {
      hint = hintOf(line);
    } else if (!line.startsWith('#')) {
      const path = pathOf(line, baseDir);
      if (path !== null) entries.push({ path, artist: hint?.artist ?? null, title: hint?.title ?? null });
      hint = null;
    }
  }
  return { name, entries };
}
