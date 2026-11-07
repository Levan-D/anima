/*
 * The services the app asks things of online, and where it asks them. Any of them could move or shut down, so the
 * address is the person's to change, to a mirror or a copy they run themselves, and each can be turned off.
 */

import { err, ok, type Result } from './result';

export const ONLINE_SERVICE_IDS = ['lrclib', 'musicbrainz', 'listenbrainz'] as const;

export type OnlineServiceId = (typeof ONLINE_SERVICE_IDS)[number];

export type OnlineServiceSetting = {
  isOn: boolean;
  /** Null asks the service's own address. */
  address: string | null;
};

export type OnlineServiceSettings = Record<OnlineServiceId, OnlineServiceSetting>;

export const ONLINE_SERVICES: Record<OnlineServiceId, { name: string; defaultAddress: string }> = {
  lrclib: { name: 'LRCLIB', defaultAddress: 'https://lrclib.net/api' },
  musicbrainz: { name: 'MusicBrainz', defaultAddress: 'https://musicbrainz.org/ws/2' },
  listenbrainz: { name: 'ListenBrainz Labs', defaultAddress: 'https://labs.api.listenbrainz.org' },
};

export const ONLINE_SERVICES_DEFAULT: OnlineServiceSettings = {
  lrclib: { isOn: true, address: null },
  musicbrainz: { isOn: true, address: null },
  listenbrainz: { isOn: true, address: null },
};

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

/** What was typed, as an address requests can be built on: no trailing slash, nothing after the path. */
export function checkAddress(typed: string): Result<string> {
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
  if (url.search !== '' || url.hash !== '') return err('invalid_input', "An address can't have ? or # in it");
  return ok(`${url.origin}${url.pathname}`.replace(/\/+$/, ''));
}
