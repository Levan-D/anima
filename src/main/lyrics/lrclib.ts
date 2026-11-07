/* What LRCLIB expects from a client, and which of its answers to believe. Knows nothing about the database. */

import { setTimeout as wait } from 'node:timers/promises';
import * as z from 'zod';
import { offWords, ONLINE_SERVICES } from '@shared/onlineServices';
import { err, errorText, ok, type Result } from '@shared/result';
import { baseTitle, normalizeName } from '@main/library/names';
import { readCappedText } from '@main/system/cappedText';
import { retryDelayMs } from '@main/system/retryDelay';

// scripts/lyrics-dump reads this module's rules, these two among them.
export { baseTitle, normalizeName };

// A search with every lyric in it is well under this. Anything bigger isn't an answer.
const MAX_REPLY_BYTES = 4 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;
// About 86 a minute, just under the 90 LRCLIB allows a client that identifies itself.
const REQUEST_GAP_MS = 700;
const MAX_ATTEMPTS = 6;
const MAX_DURATION_SECONDS = 3600;
export const DURATION_TOLERANCE_SECONDS = 2;
/** How far a record's length can be off and still count, once nothing closer has words. */
export const WIDEST_DURATION_SECONDS = 15;
const SYNC_DURATION_SECONDS = 5;
const SYNC_OVERRUN_SECONDS = 5;
const LOOSE_SHORTER_SECONDS = 60;
const MIN_LYRIC_WORDS = 15;
const FULL_SYNC_REACH = 0.85;
const FULLER_SYNC_WORDS = 1.15;
const MIN_SHARE_OF_USUAL_WORDS = 0.7;
const INSTRUMENTAL_VOTES_PER_SUNG = 7;
const MAX_OTHER_SCRIPT_SHARE = 0.3;
const LETTERS_PER_TYPO = 7;
const MIN_LETTERS_FOR_TYPOS = 5;
const NO_VOCALS = /\b(instrumentals?|karaoke|orchestral)\b/i;
const BRACKETED = /\[[^\]]*\]/g;
const TAG_LINE = /^\s*\[(?:ar|al|ti|au|by|re|ve|tool|length|offset):[^\]]*\]\s*$/gim;
const HEADER_LINE = /^\s*(?:artist|album|title)\s*:.*$/gim;
const WORD = /[\p{L}\p{N}]+/gu;
const LETTER = /\p{L}/gu;
const OTHER_SCRIPT =
  /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Hebrew}]/gu;
const TIMESTAMP = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;
const PART_NUMBER = /\b(?:part|pt|vol|volume)\b\.?\s*(\d+|i{1,3}|iv|vi{0,3}|ix|x)\b/i;
const ROMAN_PARTS = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'];
const NUMBERS = /\b(?:\d+|[ivx]{2,})\b/g;
const FEATURED = /\s+(?:feat|ft)\b.*$/i;

const recordSchema = z.object({
  id: z.number(),
  trackName: z.string(),
  artistName: z.string(),
  albumName: z
    .string()
    .nullable()
    .transform((album) => album ?? ''),
  duration: z.number(),
  instrumental: z.boolean(),
  plainLyrics: z.string().nullable(),
  syncedLyrics: z.string().nullable(),
});

export type LrclibRecord = z.infer<typeof recordSchema>;

type RecordTags = Pick<LrclibRecord, 'trackName' | 'artistName' | 'albumName' | 'duration'>;

export type LrclibTrack = {
  title: string;
  artist: string;
  album: string | null;
  durationMs: number;
};

export type LrclibVia = 'exact' | 'any_album' | 'search' | 'same_album' | 'loose';

export type LrclibMatch = {
  via: LrclibVia;
  id: number;
  title: string;
  artist: string;
  album: string;
  durationSeconds: number;
};

export type LrclibLyrics =
  | { status: 'found'; syncedLrc: string | null; plainText: string | null; match: LrclibMatch }
  | { status: 'instrumental'; match: LrclibMatch }
  | { status: 'not_found' };

type LrclibDeps = {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  random: () => number;
  /** Read at each request, since it's the person's to move to a mirror. */
  address: () => string;
  isOn: () => boolean;
};

const WRONG_SHAPE = "It answered, but not the way LRCLIB does, so this app can't read it";

type Reply =
  | { kind: 'answer'; body: unknown }
  | { kind: 'refused'; status: number | null; retryAfter: string | null; message: string };

function partOf(title: string): number | null {
  const part = PART_NUMBER.exec(title)?.[1]?.toLowerCase();
  if (part === undefined) return null;
  const roman = ROMAN_PARTS.indexOf(part);
  return roman === -1 ? Number(part) : roman + 1;
}

function titlesMatch(a: string, b: string): boolean {
  const [partA, partB] = [partOf(a), partOf(b)];
  if (partA !== null && partB !== null && partA !== partB) return false;
  return normalizeName(a) === normalizeName(b) || normalizeName(baseTitle(a)) === normalizeName(baseTitle(b));
}

function containsWords(text: string, words: string): boolean {
  return ` ${text} `.includes(` ${words} `);
}

// I strip featured artists from my tags, and LRCLIB's records usually keep them, so one has to contain the other.
export function artistsMatch(a: string, b: string): boolean {
  const first = normalizeName(a);
  const second = normalizeName(b);
  return containsWords(first, second) || containsWords(second, first);
}

function durationGap(track: LrclibTrack, record: RecordTags): number {
  return Math.abs(record.duration - track.durationMs / 1000);
}

// "Song" on "Album (Instrumental Version)" has the sung one's title and length, but not its lyrics.
function saysNoVocals(title: string, album: string | null): boolean {
  return NO_VOCALS.test(title) || (album !== null && NO_VOCALS.test(album));
}

function agreesOnVocals(track: LrclibTrack, record: RecordTags): boolean {
  return saysNoVocals(track.title, track.album) === saysNoVocals(record.trackName, record.albumName);
}

// A soundtrack tagged with the film as its artist still names the film in its album. Only that way round: "Greatest Hits"
// says nothing about "Led Zeppelin Greatest Hits". An album named after the song says nothing either.
function albumsAgree(track: LrclibTrack, albumName: string): boolean {
  if (track.album === null) return false;
  const tag = normalizeName(track.album);
  const isNamedAfterSong = normalizeName(baseTitle(track.album)) === normalizeName(baseTitle(track.title));
  return tag !== '' && !isNamedAfterSong && containsWords(normalizeName(albumName), tag);
}

function hasSameCredit(track: LrclibTrack, record: RecordTags): boolean {
  return artistsMatch(track.artist, record.artistName) || albumsAgree(track, record.albumName);
}

/** /api/get checks names and length itself. Search results and the database dump don't, so they get checked here. */
export function isSameSong(
  track: LrclibTrack,
  record: RecordTags,
  toleranceSeconds = DURATION_TOLERANCE_SECONDS,
): boolean {
  return (
    durationGap(track, record) <= toleranceSeconds &&
    agreesOnVocals(track, record) &&
    titlesMatch(track.title, record.trackName) &&
    hasSameCredit(track, record)
  );
}

function stampSeconds(stamp: RegExpMatchArray): number {
  return Number(stamp[1]) * 60 + Number(stamp[2]?.replace(':', '.'));
}

export function lastTimestampSeconds(lrc: string): number | null {
  const stamps = [...lrc.matchAll(TIMESTAMP)];
  if (stamps.length === 0) return null;
  return stamps.reduce((last, stamp) => Math.max(last, stampSeconds(stamp)), 0);
}

function countWords(text: string): number {
  return text.replace(BRACKETED, ' ').match(WORD)?.length ?? 0;
}

/** Most syncs close on a stamp with no words after it, so their last stamp says nothing about how far the words go. */
function sungIn(lrc: string): { sungUntil: number; words: number } {
  let sungUntil = 0;
  let words = 0;
  for (const line of lrc.split(/\r\n|\r|\n/)) {
    const stamps = [...line.matchAll(TIMESTAMP)];
    const wordsOnLine = countWords(line);
    if (stamps.length === 0 || wordsOnLine === 0) continue;
    words += wordsOnLine;
    sungUntil = stamps.reduce((last, stamp) => Math.max(last, stampSeconds(stamp)), sungUntil);
  }
  return { sungUntil, words };
}

// Some uploads hold only "Artist:", "Album:" and "Title:" lines, or a few words that can't be the song.
function hasLyrics(text: string | null): text is string {
  const words = text?.replace(BRACKETED, ' ').replace(HEADER_LINE, ' ').match(WORD);
  return (words?.length ?? 0) >= MIN_LYRIC_WORDS;
}

function isInAnotherScript(text: string, track: LrclibTrack): boolean {
  const body = text.replace(BRACKETED, ' ');
  const others = body.match(OTHER_SCRIPT)?.length ?? 0;
  if (others <= (body.match(LETTER)?.length ?? 0) * MAX_OTHER_SCRIPT_SHARE) return false;
  return `${track.artist} ${track.title} ${track.album ?? ''}`.match(OTHER_SCRIPT) === null;
}

// Kana on a track tagged in Latin letters is an upload for something else, whatever its title says.
function reads(text: string | null, track: LrclibTrack): text is string {
  return hasLyrics(text) && !isInAnotherScript(text, track);
}

function plainThatReads({ plainLyrics }: LrclibRecord, track: LrclibTrack): string | null {
  return reads(plainLyrics, track) ? plainLyrics.replace(TAG_LINE, '').replace(HEADER_LINE, '').trim() : null;
}

// A stamp past the end of the song, even a closing one with no words, means these lyrics belong to a different version.
function syncedThatFits(record: LrclibRecord, track: LrclibTrack): string | null {
  const synced = record.syncedLyrics;
  if (!reads(synced, track) || durationGap(track, record) > SYNC_DURATION_SECONDS) return null;
  const last = lastTimestampSeconds(synced);
  return last !== null && last <= track.durationMs / 1000 + SYNC_OVERRUN_SECONDS ? synced : null;
}

export function lyricsFrom(record: LrclibRecord, track: LrclibTrack, via: LrclibVia): LrclibLyrics {
  const match = {
    via,
    id: record.id,
    title: record.trackName,
    artist: record.artistName,
    album: record.albumName,
    durationSeconds: record.duration,
  };
  if (record.instrumental || saysNoVocals(track.title, track.album)) return { status: 'instrumental', match };
  const syncedLrc = syncedThatFits(record, track);
  const plainText = plainThatReads(record, track);
  if (syncedLrc === null && plainText === null) return { status: 'not_found' };
  return { status: 'found', syncedLrc, plainText, match };
}

function reachesTheEnd(lyrics: LrclibLyrics, track: LrclibTrack): boolean {
  if (lyrics.status !== 'found' || lyrics.syncedLrc === null) return false;
  return (lastTimestampSeconds(lyrics.syncedLrc) ?? 0) >= (track.durationMs / 1000) * FULL_SYNC_REACH;
}

function strength(lyrics: LrclibLyrics, track: LrclibTrack): number {
  if (lyrics.status === 'not_found') return 0;
  if (lyrics.status === 'instrumental') return 1;
  if (lyrics.syncedLrc === null) return 2;
  return reachesTheEnd(lyrics, track) ? 4 : 3;
}

function isFinal(lyrics: LrclibLyrics, track: LrclibTrack): boolean {
  if (lyrics.status === 'instrumental') return saysNoVocals(track.title, track.album);
  return reachesTheEnd(lyrics, track);
}

type Answer = { record: LrclibRecord; lyrics: LrclibLyrics; reach: number; sungUntil: number; words: number };

function answerFrom(record: LrclibRecord, track: LrclibTrack): Answer {
  const lyrics = lyricsFrom(record, track, 'search');
  if (lyrics.status !== 'found') return { record, lyrics, reach: 0, sungUntil: 0, words: 0 };
  if (lyrics.syncedLrc === null) {
    return { record, lyrics, reach: 0, sungUntil: 0, words: countWords(lyrics.plainText ?? '') };
  }
  return { record, lyrics, reach: lastTimestampSeconds(lyrics.syncedLrc) ?? 0, ...sungIn(lyrics.syncedLrc) };
}

function medianOf(values: number[]): number {
  return values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
}

function bestOf(track: LrclibTrack, records: LrclibRecord[]): Answer | null {
  const answers = records
    .map((record) => answerFrom(record, track))
    .filter(({ lyrics }) => lyrics.status !== 'not_found');
  const sung = answers.filter(({ lyrics }) => lyrics.status === 'found');
  // One upload's words shouldn't outvote everyone who says there are none. People flag sung songs too, so it takes many.
  const isInstrumental = answers.length - sung.length >= sung.length * INSTRUMENTAL_VOTES_PER_SUNG;
  const sameArtist = ({ record }: Answer) => Number(artistsMatch(track.artist, record.artistName));
  // A record credited only through its album can be another song, so it can't show the artist's own to be unfinished.
  const artistHasSync = sung.some((answer) => answer.reach > 0 && sameArtist(answer) === 1);
  const peers = artistHasSync ? sung.filter((answer) => sameArtist(answer) === 1) : sung;
  const syncs = peers.filter(({ reach }) => reach > 0);
  const furthest = Math.max(0, ...syncs.map(({ reach }) => reach));
  const usualWords = medianOf(peers.map(({ words }) => words));

  // A sync that stops partway or holds only the choruses is unfinished, so it only wins when nothing holds more of the song.
  const isUnfinished = ({ reach, sungUntil, words }: Answer) =>
    reach < furthest * FULL_SYNC_REACH ||
    words < usualWords * MIN_SHARE_OF_USUAL_WORDS ||
    syncs.some((rival) => rival.sungUntil * FULL_SYNC_REACH >= sungUntil && rival.words >= words * FULLER_SYNC_WORDS);
  const tierOf = (answer: Answer) => {
    if (answer.lyrics.status !== 'found') return isInstrumental ? 5 : 1;
    if (answer.lyrics.syncedLrc === null) return 2;
    return isUnfinished(answer) ? 3 : 4;
  };
  const sameAlbum = ({ record }: Answer) =>
    Number(track.album !== null && normalizeName(track.album) === normalizeName(record.albumName));
  const sameName = ({ record }: Answer) =>
    Number(
      normalizeName(track.title) === normalizeName(record.trackName) &&
        normalizeName(track.artist) === normalizeName(record.artistName),
    );

  const [best] = answers
    .map((answer) => ({ ...answer, tier: tierOf(answer) }))
    .toSorted(
      (a, b) =>
        b.tier - a.tier ||
        sameArtist(b) - sameArtist(a) ||
        sameAlbum(b) - sameAlbum(a) ||
        sameName(b) - sameName(a) ||
        durationGap(track, a.record) - durationGap(track, b.record) ||
        a.record.id - b.record.id,
    );
  return best ?? null;
}

// A nudge can close a small gap in length but can't give plain lyrics timing, so a sync holding most of their words wins.
function syncNearby(track: LrclibTrack, records: LrclibRecord[], plain: Answer): Answer | null {
  const syncs = records.filter((record) => {
    if (!isSameSong(track, record, SYNC_DURATION_SECONDS)) return false;
    const { lyrics, words } = answerFrom(record, track);
    return lyrics.status === 'found' && lyrics.syncedLrc !== null && words >= plain.words * MIN_SHARE_OF_USUAL_WORDS;
  });
  return bestOf(track, syncs);
}

function recordWithWords(answer: Answer | null): LrclibRecord | null {
  return answer?.lyrics.status === 'found' ? answer.record : null;
}

export function pickBestRecord(track: LrclibTrack, records: LrclibRecord[]): LrclibRecord | null {
  const closeEnough = records.filter((record) => isSameSong(track, record));
  const close = bestOf(track, closeEnough);
  if (close?.lyrics.status === 'found') {
    const nearby = close.lyrics.syncedLrc === null ? syncNearby(track, records, close) : null;
    return (nearby ?? close).record;
  }
  // Words and flags side by side were a real vote, and the flags won it. A flag alone can't speak for words further off.
  if (close !== null && closeEnough.some((record) => answerFrom(record, track).lyrics.status === 'found')) {
    return close.record;
  }
  const widest = bestOf(
    track,
    records.filter((record) => isSameSong(track, record, WIDEST_DURATION_SECONDS)),
  );
  return recordWithWords(widest) ?? close?.record ?? widest?.record ?? null;
}

function isCutShort(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.includes(' ') && containsWords(long, short);
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const replaced = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, replaced);
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

function hasTypos(a: string, b: string): boolean {
  const first = normalizeName(baseTitle(a)).replaceAll(' ', '');
  const second = normalizeName(baseTitle(b)).replaceAll(' ', '');
  const shorter = Math.min(first.length, second.length);
  const allowed = Math.max(1, Math.floor(shorter / LETTERS_PER_TYPO));
  const numbersOf = (title: string) => normalizeName(title).match(NUMBERS)?.join(' ') ?? '';
  return (
    shorter >= MIN_LETTERS_FOR_TYPOS &&
    numbersOf(a) === numbersOf(b) &&
    Math.abs(first.length - second.length) <= allowed &&
    editDistance(first, second) <= allowed
  );
}

/** Typed a letter or two wrong, or cut short of the other. Only the same artist at the same length can get away with it. */
export function titlesNearlyMatch(a: string, b: string): boolean {
  const formsOf = (title: string) => [normalizeName(title), normalizeName(baseTitle(title))];
  return formsOf(a).some((x) => formsOf(b).some((y) => isCutShort(x, y))) || hasTypos(a, b);
}

/** A channel's upload can carry its own name as the artist and "Artist - Title" as the title. */
export function trackNamedInTitle(track: LrclibTrack): LrclibTrack | null {
  const [artist, title, ...more] = track.title.split(' - ');
  if (artist === undefined || title === undefined || more.length > 0) return null;
  return { ...track, artist: artist.replace(FEATURED, ''), title: title.replace(FEATURED, '') };
}

type LooseReading = { as: LrclibTrack; matches: (record: RecordTags) => boolean };

function looseReadings(track: LrclibTrack): LooseReading[] {
  const sameArtist = (record: RecordTags) => artistsMatch(track.artist, record.artistName);
  const named = trackNamedInTitle(track);
  return [
    // A soundtrack tagged with the film as its artist, on an album its tag doesn't name or that's named after the song.
    {
      as: track,
      matches: (record) =>
        durationGap(track, record) <= WIDEST_DURATION_SECONDS &&
        titlesMatch(track.title, record.trackName) &&
        containsWords(normalizeName(record.albumName), normalizeName(track.artist)),
    },
    ...(named === null
      ? []
      : [{ as: named, matches: (record: RecordTags) => isSameSong(named, record, WIDEST_DURATION_SECONDS) }]),
    {
      as: track,
      matches: (record) =>
        durationGap(track, record) <= DURATION_TOLERANCE_SECONDS &&
        sameArtist(record) &&
        titlesNearlyMatch(track.title, record.trackName),
    },
    // A clipped file still has the song's words, though not its timing: lyricsFrom keeps sync only within a few seconds.
    {
      as: track,
      matches: (record) =>
        record.duration >= track.durationMs / 1000 - LOOSE_SHORTER_SECONDS &&
        sameArtist(record) &&
        normalizeName(track.title) === normalizeName(record.trackName),
    },
  ];
}

/** For a track nothing else answers. It reads the tags loosely, so it takes words only: a flag isn't an answer here. */
export function pickLooseRecord(track: LrclibTrack, records: LrclibRecord[]): LrclibRecord | null {
  for (const { as, matches } of looseReadings(track)) {
    const pool = records.filter((record) => agreesOnVocals(as, record) && matches(record));
    const close = pool.filter((record) => durationGap(as, record) <= DURATION_TOLERANCE_SECONDS);
    const best = recordWithWords(bestOf(as, close)) ?? recordWithWords(bestOf(as, pool));
    if (best !== null) return best;
  }
  return null;
}

/** Whether a record could ever answer for a track, and so whether a reader of the dump has to fetch its lyrics. */
export function mayAnswer(track: LrclibTrack, record: RecordTags): boolean {
  if (isSameSong(track, record, WIDEST_DURATION_SECONDS)) return true;
  return looseReadings(track).some(({ as, matches }) => agreesOnVocals(as, record) && matches(record));
}

function readRecord(body: unknown): Result<LrclibRecord | null> {
  if (body === null) return ok(null);
  const record = recordSchema.safeParse(body);
  return record.success ? ok(record.data) : err('network', "LRCLIB sent a record this app can't read");
}

function readRecords(body: unknown): LrclibRecord[] {
  if (!Array.isArray(body)) return [];
  return body.flatMap((item: unknown) => {
    const record = recordSchema.safeParse(item);
    return record.success ? [record.data] : [];
  });
}

/** One client per app, so every request shares the pacing. `userAgent` is LRCLIB's rule: name and version at least. */
export function createLrclibClient(userAgent: string, overrides: Partial<LrclibDeps> = {}) {
  const {
    fetch: send,
    sleep,
    now,
    random,
    address,
    isOn,
  }: LrclibDeps = {
    fetch: (url, init) => fetch(url, init),
    sleep: (ms) => wait(ms),
    now: () => Date.now(),
    random: () => Math.random(),
    address: () => ONLINE_SERVICES.lrclib.defaultAddress,
    isOn: () => true,
    ...overrides,
  };
  let nextRequestAt = 0;
  const urlOf = (path: string, params: Record<string, string>) =>
    `${address()}/${path}?${new URLSearchParams(params).toString()}`;

  async function takeTurn(): Promise<void> {
    const startAt = Math.max(now(), nextRequestAt);
    nextRequestAt = startAt + REQUEST_GAP_MS;
    if (startAt > now()) await sleep(startAt - now());
  }

  async function sendOnce(url: string): Promise<Reply> {
    try {
      const response = await send(url, {
        headers: { 'User-Agent': userAgent },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.ok) {
        const body = await readCappedText(response, MAX_REPLY_BYTES);
        if (body === null) {
          return { kind: 'refused', status: null, retryAfter: null, message: 'LRCLIB sent far more than an answer' };
        }
        return { kind: 'answer', body: JSON.parse(body) as unknown };
      }
      await response.body?.cancel();
      if (response.status === 404) return { kind: 'answer', body: null };
      return {
        kind: 'refused',
        status: response.status,
        retryAfter: response.headers.get('Retry-After'),
        message: `LRCLIB answered ${response.status}`,
      };
    } catch (error) {
      return { kind: 'refused', status: null, retryAfter: null, message: `Couldn't reach LRCLIB: ${errorText(error)}` };
    }
  }

  /** The value is null for a 404, which is how LRCLIB says it has no record. */
  async function ask(path: string, params: Record<string, string>): Promise<Result<unknown>> {
    if (!isOn()) return err('service_off', offWords('lrclib'));
    const url = urlOf(path, params);
    for (let attempt = 1; ; attempt += 1) {
      await takeTurn();
      const reply = await sendOnce(url);
      if (reply.kind === 'answer') return ok(reply.body);
      const delay = retryDelayMs(reply.status, reply.retryAfter, attempt, now(), random());
      if (delay === null || attempt === MAX_ATTEMPTS) {
        return err(reply.status === 429 ? 'rate_limited' : 'network', reply.message);
      }
      await sleep(delay);
    }
  }

  async function getRecord(params: Record<string, string>): Promise<Result<LrclibRecord | null>> {
    const answer = await ask('get', params);
    return answer.ok ? readRecord(answer.value) : answer;
  }

  async function searchRecord(
    track: LrclibTrack,
    among: { artist_name: string } | { album_name: string },
  ): Promise<Result<LrclibRecord | null>> {
    const answer = await ask('search', { track_name: baseTitle(track.title), ...among });
    return answer.ok ? ok(pickBestRecord(track, readRecords(answer.value))) : answer;
  }

  /**
   * Asks exactly first, then wider, and stops at lyrics nothing could beat: a sync that reaches the end of the song, or
   * tags that say there are no vocals. Anything less is kept in case nothing better turns up, an instrumental flag too,
   * since people flag sung songs.
   */
  async function lookup(track: LrclibTrack): Promise<Result<LrclibLyrics>> {
    const seconds = Math.round(track.durationMs / 1000);
    if (seconds < 1 || seconds > MAX_DURATION_SECONDS) return ok({ status: 'not_found' });

    const params = { track_name: track.title, artist_name: track.artist, duration: String(seconds) };
    const steps: { via: LrclibVia; run: () => Promise<Result<LrclibRecord | null>> }[] = [
      { via: 'any_album', run: () => getRecord(params) },
      { via: 'search', run: () => searchRecord(track, { artist_name: track.artist }) },
    ];
    const { album } = track;
    if (album !== null) {
      steps.unshift({ via: 'exact', run: () => getRecord({ ...params, album_name: album }) });
      steps.push({ via: 'same_album', run: () => searchRecord(track, { album_name: album }) });
    }

    let best: LrclibLyrics = { status: 'not_found' };
    for (const { via, run } of steps) {
      const answer = await run();
      if (!answer.ok) return answer;
      if (answer.value === null || !agreesOnVocals(track, answer.value)) continue;
      const lyrics = lyricsFrom(answer.value, track, via);
      if (strength(lyrics, track) > strength(best, track)) best = lyrics;
      if (isFinal(best, track)) break;
    }
    return ok(best);
  }

  /** For a person reading the list: whatever matches anywhere, unjudged. */
  async function search(query: string): Promise<Result<LrclibRecord[]>> {
    const answer = await ask('search', { q: query });
    return answer.ok ? ok(readRecords(answer.value)) : answer;
  }

  async function record(id: number): Promise<Result<LrclibRecord | null>> {
    const answer = await ask(`get/${id}`, {});
    return answer.ok ? readRecord(answer.value) : answer;
  }

  /** One search, off or on and with no retries, and whether what comes back reads as LRCLIB's. */
  async function test(): Promise<Result<void>> {
    await takeTurn();
    const reply = await sendOnce(urlOf('search', { q: 'hello' }));
    if (reply.kind === 'refused') return err('network', reply.message);
    const isList = Array.isArray(reply.body);
    const first: unknown = isList ? (reply.body as unknown[])[0] : undefined;
    const reads = isList && (first === undefined || recordSchema.safeParse(first).success);
    return reads ? ok() : err('network', WRONG_SHAPE);
  }

  return { lookup, search, record, test };
}
