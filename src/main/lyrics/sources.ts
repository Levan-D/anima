/* Where a track's lyrics can come from, and which one wins. */

import { readFile } from 'node:fs/promises';
import { parseFile } from 'music-metadata';
import type { Lyrics, LyricsSource } from '@shared/domain';
import { countWords, parseLrc, plainFrom, type ParsedLyrics } from './lrc';

/** Shorter than this, embedded text is a note or a credit. */
const MIN_EMBEDDED_WORDS = 15;
const UNAVAILABLE = 'No lyrics right now';

export type StoredLyrics = {
  status: 'found' | 'not_found' | 'instrumental';
  syncedLrc: string | null;
  plainText: string | null;
};

type Sources = {
  sidecar: ParsedLyrics | null;
  stored: StoredLyrics | null;
  embedded: ParsedLyrics | null;
  lookupFailed: boolean;
};

export type PickedLyrics =
  Exclude<Lyrics, { status: 'found' }> | Omit<Extract<Lyrics, { status: 'found' }>, 'offsetMs'>;

export function parseStored(stored: StoredLyrics | null): ParsedLyrics | null {
  if (stored?.status !== 'found') return null;
  const synced = stored.syncedLrc === null ? null : parseLrc(stored.syncedLrc);
  const plain = stored.plainText === null ? null : plainFrom(stored.plainText);
  return { synced: synced?.synced ?? null, plain: plain ?? synced?.plain ?? null };
}

/** Timed comes first wherever it's from, then plain, then what the table remembers about there being none. */
export function pickLyrics({ sidecar, stored, embedded, lookupFailed }: Sources): PickedLyrics {
  const table = parseStored(stored);
  const timed: [LyricsSource, ParsedLyrics | null][] = [
    ['sidecar', sidecar],
    ['lrclib', table],
    ['embedded', embedded],
  ];
  for (const [source, parsed] of timed) {
    if (parsed?.synced) return { status: 'found', source, synced: parsed.synced, plain: parsed.plain };
  }
  const plain: [LyricsSource, ParsedLyrics | null][] = [
    ['sidecar', sidecar],
    ['embedded', embedded],
    ['lrclib', table],
  ];
  for (const [source, parsed] of plain) {
    if (parsed?.plain) return { status: 'found', source, synced: null, plain: parsed.plain };
  }
  if (stored?.status === 'instrumental') return { status: 'instrumental' };
  return lookupFailed ? { status: 'unavailable', message: UNAVAILABLE } : { status: 'none' };
}

export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** Null for no file, which is the usual case, and for one that can't be read. */
export async function readSidecar(audioPath: string): Promise<ParsedLyrics | null> {
  const dot = audioPath.lastIndexOf('.');
  try {
    return parseLrc(decodeText(await readFile(`${dot === -1 ? audioPath : audioPath.slice(0, dot)}.lrc`)));
  } catch {
    return null;
  }
}

export function embeddedLyrics(texts: string[]): ParsedLyrics | null {
  const text = texts.find((candidate) => countWords(plainFrom(candidate) ?? '') >= MIN_EMBEDDED_WORDS);
  return text === undefined ? null : parseLrc(text);
}

/** A track's tags hold no lyrics, as a rule. A file that can't be read just has none. */
export async function readEmbedded(audioPath: string): Promise<ParsedLyrics | null> {
  try {
    const { common } = await parseFile(audioPath, { skipCovers: true });
    return embeddedLyrics((common.lyrics ?? []).flatMap(({ text }) => (text === undefined ? [] : [text])));
  } catch {
    return null;
  }
}
