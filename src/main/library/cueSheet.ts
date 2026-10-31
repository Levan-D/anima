/* A CUE sheet, as text in and plain data out. Nothing past this edge checks a sheet again. */

import { err, ok, type Result } from '@shared/result';
import type { FileTags } from '@main/library/tags';

const FRAMES_PER_SECOND = 75;
const FIRST_AUDIO_INDEX = 1;

export type CueTrack = {
  number: number;
  title: string | null;
  performer: string | null;
  startMs: number;
  /** The next track's start. Null for the last one, which runs to the end of the file. */
  endMs: number | null;
};

type CueFile = {
  name: string;
  tracks: CueTrack[];
};

export type CueSheet = {
  title: string | null;
  performer: string | null;
  files: CueFile[];
};

/** One file cut into tracks: the only kind of sheet that changes anything. */
export type CueSplit = {
  title: string | null;
  performer: string | null;
  fileName: string;
  tracks: CueTrack[];
};

export type TrackPlan = {
  cueIndex: number;
  startMs: number;
  endMs: number | null;
  tags: FileTags;
};

const bad = (message: string) => err('cue_invalid', message);

function unquoted(value: string): string | null {
  const text = /^"([^"]*)"?/.exec(value)?.[1] ?? value;
  const trimmed = text.trim();
  return trimmed === '' ? null : trimmed;
}

function fileNameIn(value: string): string | null {
  return unquoted(/^"[^"]*"|^\S+/.exec(value)?.[0] ?? '');
}

function toMs(minutes: string, seconds: string, frames: string): number | null {
  const [m, s, f] = [Number(minutes), Number(seconds), Number(frames)];
  if (s >= 60 || f >= FRAMES_PER_SECOND) return null;
  return Math.round((m * 60 + s + f / FRAMES_PER_SECOND) * 1000);
}

export function parseCueSheet(text: string): Result<CueSheet> {
  const sheet: CueSheet = { title: null, performer: null, files: [] };
  let file: CueFile | null = null;
  let track: { number: number; title: string | null; performer: string | null; hasStart: boolean } | null = null;
  const numbers = new Set<number>();

  for (const raw of text.split(/\r\n|\r|\n/)) {
    const [, command = '', rest = ''] = /^\s*(\S+)\s*(.*?)\s*$/.exec(raw) ?? [];
    switch (command.toUpperCase()) {
      case 'FILE': {
        const name = fileNameIn(rest);
        if (name === null) return bad('A FILE line names nothing');
        file = { name, tracks: [] };
        sheet.files.push(file);
        break;
      }
      case 'TRACK': {
        if (file === null) return bad('A TRACK comes before any FILE');
        if (track !== null && !track.hasStart) return bad(`Track ${track.number} has no INDEX 01`);
        const number = Number(/^(\d+)(?:\s|$)/.exec(rest)?.[1] ?? Number.NaN);
        if (Number.isNaN(number) || numbers.has(number)) return bad(`A TRACK line makes no sense: ${rest}`);
        numbers.add(number);
        track = { number, title: null, performer: null, hasStart: false };
        break;
      }
      case 'TITLE':
        if (track === null) sheet.title = unquoted(rest);
        else {
          track.title = unquoted(rest);
          attach(file, track);
        }
        break;
      case 'PERFORMER':
        if (track === null) sheet.performer = unquoted(rest);
        else {
          track.performer = unquoted(rest);
          attach(file, track);
        }
        break;
      case 'INDEX': {
        const [, index, minutes = '', seconds = '', frames = ''] =
          /^(\d+)\s+(\d+):(\d{1,2}):(\d{1,2})$/.exec(rest) ?? [];
        if (index === undefined || track === null || file === null) return bad(`An INDEX line makes no sense: ${rest}`);
        if (Number(index) !== FIRST_AUDIO_INDEX) break;
        const startMs = toMs(minutes, seconds, frames);
        if (startMs === null) return bad(`An INDEX line makes no sense: ${rest}`);
        const last = file.tracks.at(-1);
        if (last !== undefined && last.startMs >= startMs)
          return bad(`Track ${track.number} starts before the last one`);
        if (last !== undefined) last.endMs = startMs;
        file.tracks.push({
          number: track.number,
          title: track.title,
          performer: track.performer,
          startMs,
          endMs: null,
        });
        track.hasStart = true;
        break;
      }
      default:
    }
  }

  if (track !== null && !track.hasStart) return bad(`Track ${track.number} has no INDEX 01`);
  sheet.files = sheet.files.filter(({ tracks }) => tracks.length > 0);
  return sheet.files.length > 0 ? ok(sheet) : bad('It has no tracks');
}

/** A TITLE or PERFORMER can come after the track's INDEX 01. */
function attach(file: CueFile | null, track: { number: number; title: string | null; performer: string | null }): void {
  const placed = file?.tracks.at(-1);
  if (placed?.number !== track.number) return;
  placed.title = track.title;
  placed.performer = track.performer;
}

/** Null when the files are the tracks already, which is what a sheet written for a rip of separate files says. */
export function splitOf(sheet: CueSheet): Result<CueSplit | null> {
  const [only] = sheet.files;
  if (only !== undefined && sheet.files.length === 1) {
    return ok({ title: sheet.title, performer: sheet.performer, fileName: only.name, tracks: only.tracks });
  }
  const isOneTrackEach = sheet.files.every(({ tracks }) => tracks.length === 1 && tracks[0]?.startMs === 0);
  return isOneTrackEach ? ok(null) : bad("It cuts several files into tracks, which isn't supported");
}

/** A path can come from another machine, so only the name counts, and it has to be beside the sheet. */
export function nameInFolder(fileName: string): string {
  return fileName.slice(Math.max(fileName.lastIndexOf('/'), fileName.lastIndexOf('\\')) + 1);
}

export function fitsFile({ tracks }: CueSplit, durationMs: number): boolean {
  return tracks.every(({ startMs }) => startMs < durationMs);
}

const defaultTitle = (number: number) => `Track ${String(number).padStart(2, '0')}`;

export function wholeFilePlan(tags: FileTags): TrackPlan[] {
  return [{ cueIndex: 0, startMs: 0, endMs: null, tags }];
}

/** What the sheet leaves out comes from the file's tags. */
export function splitPlan({ title, performer, tracks }: CueSplit, tags: FileTags): TrackPlan[] {
  return tracks.map((track, index) => ({
    cueIndex: index + 1,
    startMs: track.startMs,
    endMs: track.endMs,
    tags: {
      ...tags,
      title: track.title ?? defaultTitle(track.number),
      titleIsFileName: false,
      artist: track.performer ?? performer ?? tags.artist,
      albumArtist: performer ?? tags.albumArtist,
      album: title ?? tags.album,
      trackNumber: track.number,
    },
  }));
}
