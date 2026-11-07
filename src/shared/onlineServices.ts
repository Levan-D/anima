/*
 * The services the app asks things of online, and where it asks them. Any of them could move or shut down, so the
 * address is the person's to change, to a mirror or a copy they run themselves, and each can be turned off. For one
 * that answers in another shape, a script of theirs can stand in, saying how to ask it and how to read what it says.
 */

import { err, ok, type Result } from './result';

export const ONLINE_SERVICE_IDS = ['lrclib', 'musicbrainz', 'listenbrainz'] as const;

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
};

export const ONLINE_SERVICES_DEFAULT: OnlineServiceSettings = {
  lrclib: { isOn: true, address: null, script: null },
  musicbrainz: { isOn: true, address: null, script: null },
  listenbrainz: { isOn: true, address: null, script: null },
};

/** The ones a script can stand in for so far. */
export const SCRIPTABLE_SERVICES: ReadonlySet<OnlineServiceId> = new Set(['lrclib']);

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
