/*
 * The services the app asks things of online, and where it asks them. Any of them could move or shut down, so the
 * address is the person's to change, to a mirror or a copy they run themselves, and each can be turned off. For one
 * that answers in another shape, a script of theirs can stand in, saying how to ask it and how to read what it says.
 */

import { err, ok, type Result } from './result';

export const ONLINE_SERVICE_IDS = ['lrclib', 'musicbrainz', 'listenbrainz', 'autoeq'] as const;

export type OnlineServiceId = (typeof ONLINE_SERVICE_IDS)[number];

export type OnlineServiceSetting = {
  isOn: boolean;
  /** Null asks the service's own address. */
  address: string | null;
  /** The person's own way of asking a different service in its place. Null asks this one, the usual way. */
  script: string | null;
};

export type OnlineServiceSettings = Record<OnlineServiceId, OnlineServiceSetting>;

export const ONLINE_SERVICES: Record<OnlineServiceId, { name: string; defaultAddress: string }> = {
  lrclib: { name: 'LRCLIB', defaultAddress: 'https://lrclib.net/api' },
  musicbrainz: { name: 'MusicBrainz', defaultAddress: 'https://musicbrainz.org/ws/2' },
  listenbrainz: { name: 'ListenBrainz Labs', defaultAddress: 'https://labs.api.listenbrainz.org' },
  // Its files, at a pinned commit under this. A fork on GitHub has GitHub's API for it too, which new targets need.
  autoeq: { name: 'AutoEq', defaultAddress: 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq' },
};

export const ONLINE_SERVICES_DEFAULT: OnlineServiceSettings = {
  lrclib: { isOn: true, address: null, script: null },
  musicbrainz: { isOn: true, address: null, script: null },
  listenbrainz: { isOn: true, address: null, script: null },
  autoeq: { isOn: true, address: null, script: null },
};

/** The ones whose setting can hold a script. */
export const SCRIPTABLE_SERVICES: ReadonlySet<OnlineServiceId> = new Set(['lrclib', 'listenbrainz']);

/**
 * Whose script stands in for a service. Discover data asks MusicBrainz and then ListenBrainz, and one script stands in
 * for the pair, kept with ListenBrainz's.
 */
const SCRIPT_HOLDER: Record<OnlineServiceId, OnlineServiceId> = {
  lrclib: 'lrclib',
  musicbrainz: 'listenbrainz',
  listenbrainz: 'listenbrainz',
  autoeq: 'autoeq',
};

export function scriptFor(settings: OnlineServiceSettings, id: OnlineServiceId): string | null {
  return settings[SCRIPT_HOLDER[id]].script;
}

export const SCRIPT_MAX_CHARS = 50_000;

/** How long one call into a script may run before it's stopped. */
export const SCRIPT_TIME_MS = 250;

/** How many times a script may ask, for one song. */
export const SCRIPT_MAX_ASKS = 3;

/**
 * The app's side of the handshake for lyrics, as a script that works: it asks LRCLIB itself, in the shape any other
 * service's script has to take. What it returns is checked before anything uses it.
 */
export const LYRICS_SCRIPT_EXAMPLE = `// For each song without lyrics, the app calls request(track), asks the address it returns,
// then calls parse(reply, track, ask) with what came back.
//   track: { title, artist, album (a string or null), durationSeconds }
//   reply: { status (the HTTP status), body (the answer, as text) }
//   ask:   1 for the first answer, 2 after a { next } and so on, ${SCRIPT_MAX_ASKS} at most for one song

function request(track) {
  // https, or plain http to this PC or your own network. headers is optional.
  return {
    url: 'https://lrclib.net/api/get?track_name=' + encodeURIComponent(track.title) +
      '&artist_name=' + encodeURIComponent(track.artist) +
      '&duration=' + track.durationSeconds,
    headers: { Accept: 'application/json' },
  };
}

function parse(reply, track, ask) {
  // Return null when there are none, { next: { url } } to ask somewhere else first,
  // or { plain, synced, instrumental }: plain text and timed LRC, either of them can be null.
  if (reply.status === 404) return null;
  const found = JSON.parse(reply.body);
  return { plain: found.plainLyrics, synced: found.syncedLyrics, instrumental: found.instrumental };
}
`;

/**
 * The app's side of the handshake for Discover data, as a script that works: it asks MusicBrainz who an artist or song is,
 * then ListenBrainz what their listeners also play, in the shape any other service's script has to take.
 */
export const DISCOVER_SCRIPT_EXAMPLE = `// For each artist and song in your library, the app calls request(item), asks the address it returns,
// then calls parse(reply, item, ask) with what came back.
//   item:  { kind: 'artist', artist } or { kind: 'song', artist, title }
//   reply: { status (the HTTP status), body (the answer, as text) }
//   ask:   1 for the first answer, 2 after a { next } and so on, ${SCRIPT_MAX_ASKS} at most for one item
// This one asks MusicBrainz who it is, then ListenBrainz what the people who play it also play.

const ALGORITHM = 'session_based_days_9000_session_300_contribution_5_threshold_15_limit_50_skip_30';

function quoted(text) {
  return '"' + text.replace(/["\\\\]/g, '\\\\$&') + '"';
}

function request(item) {
  // https, or plain http to this PC or your own network. method (GET or POST), body and headers are optional.
  const query = item.kind === 'artist'
    ? 'artist:' + quoted(item.artist)
    : 'recording:' + quoted(item.title) + ' AND artist:' + quoted(item.artist);
  const kind = item.kind === 'artist' ? 'artist' : 'recording';
  return {
    url: 'https://musicbrainz.org/ws/2/' + kind + '/?query=' + encodeURIComponent(query) + '&fmt=json&limit=10',
    headers: { Accept: 'application/json' },
  };
}

function parse(reply, item, ask) {
  // Return null when it knows nothing, { next: { url } } to ask somewhere else first, or { similar }:
  // for an artist [{ artist, score }], for a song [{ artist, title, score }]. Higher scores are closer.
  if (reply.status !== 200) return null;
  const data = JSON.parse(reply.body);
  if (ask === 1 && item.kind === 'artist') {
    const found = data.artists[0];
    if (!found) return null;
    return {
      next: {
        url: 'https://labs.api.listenbrainz.org/similar-artists/json?artist_mbids=' + found.id + '&algorithm=' + ALGORITHM,
      },
    };
  }
  if (ask === 1) {
    const ids = data.recordings.map((recording) => recording.id);
    if (ids.length === 0) return null;
    return {
      next: {
        url: 'https://labs.api.listenbrainz.org/similar-recordings/json',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([{ recording_mbids: ids, algorithm: ALGORITHM }]),
      },
    };
  }
  if (item.kind === 'artist') {
    return { similar: data.filter((row) => row.name).map((row) => ({ artist: row.name, score: row.score })) };
  }
  return {
    similar: data
      .filter((row) => row.recording_name && row.artist_credit_name)
      .map((row) => ({ artist: row.artist_credit_name, title: row.recording_name, score: row.score })),
  };
}
`;

export function addressOf(settings: OnlineServiceSettings, id: OnlineServiceId): string {
  return settings[id].address ?? ONLINE_SERVICES[id].defaultAddress;
}

export function offWords(id: OnlineServiceId): string {
  return `${ONLINE_SERVICES[id].name} is turned off. Configure turns it back on`;
}

const PRIVATE_IPV4 = [/^10\./, /^127\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./];

/** This PC or the home network, where a server of one's own may well have no certificate. */
function isOwnNetwork(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]' || hostname.endsWith('.local')) return true;
  return PRIVATE_IPV4.some((range) => range.test(hostname));
}

function readUrl(typed: string): Result<URL> {
  let url: URL;
  try {
    url = new URL(typed.trim());
  } catch {
    return err('invalid_input', "That isn't a web address. It starts with https://");
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isOwnNetwork(url.hostname))) {
    return err('invalid_input', 'Use https. Plain http is only for a server on this PC or your own network');
  }
  if (url.username !== '' || url.password !== '') return err('invalid_input', "An address can't hold a password");
  return ok(url);
}

/** What was typed, as an address requests can be built on: no trailing slash, nothing after the path. */
export function checkAddress(typed: string): Result<string> {
  const url = readUrl(typed);
  if (!url.ok) return url;
  if (url.value.search !== '' || url.value.hash !== '') {
    return err('invalid_input', "An address can't have ? or # in it");
  }
  return ok(`${url.value.origin}${url.value.pathname}`.replace(/\/+$/, ''));
}

/** Where a script asks, held to the same rules as an address, with a query allowed. */
export function checkRequestUrl(asked: string): Result<string> {
  const url = readUrl(asked);
  if (!url.ok) return url;
  url.value.hash = '';
  return ok(url.value.href);
}
