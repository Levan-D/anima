/*
 * What other listeners hear together, fetched on request and stored by name. Everything an answer holds is kept whether
 * it's owned or not, and nothing links to a track id, so music added later slots in without asking again.
 */

import { offWords } from '@shared/onlineServices';
import { ok, type Result } from '@shared/result';
import type { Connection } from '@main/db/connection';
import type { Dataset, DatasetOutcome, DatasetProgress } from '@main/datasets/datasets';
import type { Library } from '@main/library/library';
import { artistKey, titleKey } from '@main/library/names';
import { UNKNOWN_ARTIST } from '@main/library/tags';
import type { DiscoverAdapter } from './discoverAdapter';
import { LISTENBRAINZ, type ServiceClient, type SimilarArtist, type SimilarTrack } from './services';

/** What a script of the person's found, kept apart from ListenBrainz's answers, so either can be asked again alone. */
export const SCRIPT_SOURCE = 'script';

// Two at once, so each service gets its full share when a lookup takes one request to each of them.
const CONCURRENT_LOOKUPS = 2;
const ANNOUNCE_EVERY = 50;
const GIVE_UP_AFTER_FAILURES_IN_A_ROW = 6;
const CANT_REACH = "Stopped: the listener data services can't be reached right now. Update picks up from here.";

type TrackName = { artist: string; title: string };
type AskedRow = {
  kind: 'artist' | 'track';
  artistKey: string;
  titleKey: string;
  mbid: string | null;
  fetchedAt: number;
};

// What people play alongside an artist drifts over months, so an answer this old is asked for again on the next Update.
const STALE_AFTER_MS = 182 * 24 * 60 * 60 * 1000;

function pairKey(artist: string, title: string): string {
  return `${artist}\t${title}`;
}

/** Best first, one per target, as a share of the best in the answer. */
export function normalized<T>(answers: readonly T[], keyOf: (answer: T) => string, scoreOf: (answer: T) => number) {
  const best = Math.max(0, ...answers.map(scoreOf));
  const byKey = new Map<string, { answer: T; score: number }>();
  for (const answer of answers) {
    const key = keyOf(answer);
    const score = best > 0 ? scoreOf(answer) / best : 0;
    if (score > (byKey.get(key)?.score ?? -1)) byKey.set(key, { answer, score });
  }
  return [...byKey].map(([key, { answer, score }]) => ({ key, answer, score }));
}

function createQueries(db: Connection) {
  const artists = db.prepare<[], { name: string }>(`
    SELECT DISTINCT a.name FROM artists a
    JOIN tracks t ON t.artist_id = a.id
    JOIN files f ON f.id = t.file_id
    WHERE f.missing_since IS NULL
  `);
  const tracks = db.prepare<[], TrackName>(`
    SELECT DISTINCT a.name AS artist, t.title FROM tracks t
    JOIN artists a ON a.id = t.artist_id
    JOIN files f ON f.id = t.file_id
    WHERE f.missing_since IS NULL
  `);
  const asked = db.prepare<[string], AskedRow>(`
    SELECT kind, artist_key AS artistKey, title_key AS titleKey, mbid, fetched_at AS fetchedAt
    FROM listener_lookups WHERE source = ?
  `);
  const remember = db.prepare<[string, string, string, string, string | null, number, number]>(`
    INSERT OR REPLACE INTO listener_lookups (source, kind, artist_key, title_key, mbid, found, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const dropArtist = db.prepare<[string, string]>('DELETE FROM similar_artists WHERE source_key = ? AND source = ?');
  const addArtist = db.prepare<[string, string, string, string, number, string, number]>(`
    INSERT OR REPLACE INTO similar_artists (source_key, source_name, target_key, target_name, score, source, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const dropTrack = db.prepare<[string, string, string]>(
    'DELETE FROM similar_tracks WHERE source_artist_key = ? AND source_title_key = ? AND source = ?',
  );
  const addTrack = db.prepare<
    [string, string, string, string, string, string, string, string, number, string, number]
  >(`
    INSERT OR REPLACE INTO similar_tracks (
      source_artist_key, source_title_key, source_artist, source_title,
      target_artist_key, target_title_key, target_artist, target_title, score, source, fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const saveArtist = db.transaction(
    (name: string, mbid: string | null, similar: readonly SimilarArtist[], source: string, at: number) => {
      const key = artistKey(name);
      dropArtist.run(key, source);
      const answers = normalized(
        similar.filter((target) => artistKey(target.name) !== key),
        ({ name: target }) => artistKey(target),
        ({ score }) => score,
      );
      for (const { key: target, answer, score } of answers) {
        addArtist.run(key, name, target, answer.name, score, source, at);
      }
      remember.run(source, 'artist', key, '', mbid, answers.length > 0 ? 1 : 0, at);
    },
  );

  const saveTrack = db.transaction(
    ({ artist, title }: TrackName, similar: readonly SimilarTrack[], source: string, at: number) => {
      const [fromArtist, fromTitle] = [artistKey(artist), titleKey(title)];
      dropTrack.run(fromArtist, fromTitle, source);
      const answers = normalized(
        similar.filter(
          (target) => pairKey(artistKey(target.artist), titleKey(target.title)) !== pairKey(fromArtist, fromTitle),
        ),
        (target) => pairKey(artistKey(target.artist), titleKey(target.title)),
        ({ score }) => score,
      );
      for (const { answer, score } of answers) {
        addTrack.run(
          fromArtist,
          fromTitle,
          artist,
          title,
          artistKey(answer.artist),
          titleKey(answer.title),
          answer.artist,
          answer.title,
          score,
          source,
          at,
        );
      }
      remember.run(source, 'track', fromArtist, fromTitle, null, answers.length > 0 ? 1 : 0, at);
    },
  );

  return {
    artists: () => artists.all().map(({ name }) => name),
    tracks: () => tracks.all(),
    asked: (source: string) => asked.all(source),
    saveArtist,
    saveTrack,
  };
}

/** One of each key, with what can't be asked about left out. */
function wantedNames(artists: string[], tracks: TrackName[]) {
  const artistsByKey = new Map<string, string>();
  for (const name of artists) if (name !== UNKNOWN_ARTIST) artistsByKey.set(artistKey(name), name);
  const tracksByKey = new Map<string, TrackName>();
  for (const track of tracks) {
    if (track.artist !== UNKNOWN_ARTIST)
      tracksByKey.set(pairKey(artistKey(track.artist), titleKey(track.title)), track);
  }
  return { artistsByKey, tracksByKey };
}

async function eachAtOnce<T>(items: readonly T[], limit: number, work: (item: T) => Promise<boolean>): Promise<void> {
  let next = 0;
  const lane = async () => {
    for (;;) {
      const item = items[next];
      next += 1;
      if (item === undefined || !(await work(item))) return;
    }
  };
  await Promise.all(Array.from({ length: limit }, lane));
}

type Deps = {
  library: Pick<Library, 'perConnection' | 'folder' | 'markChanged'>;
  client: ServiceClient;
  /** The person's script in place of MusicBrainz and ListenBrainz, read at each run. Null asks those two. */
  script: () => string | null;
  byScript: Pick<DiscoverAdapter, 'similarArtists' | 'similarTracks'>;
  isOn: (service: 'musicbrainz' | 'listenbrainz') => boolean;
  announce: () => void;
  log: { warn: (...details: unknown[]) => void };
  now: () => number;
};

export function createListenerDataset({ library, client, script, byScript, isOn, announce, log, now }: Deps): Dataset {
  const queries = library.perConnection(createQueries);
  const sourceNow = () => (script() === null ? LISTENBRAINZ : SCRIPT_SOURCE);

  function plan() {
    return queries(({ artists, tracks, asked }) => {
      const { artistsByKey, tracksByKey } = wantedNames(artists(), tracks());
      const rows = asked(sourceNow());
      const askedArtists = new Map(rows.filter(({ kind }) => kind === 'artist').map((row) => [row.artistKey, row]));
      const askedTracks = new Set(
        rows.filter(({ kind }) => kind === 'track').map((row) => pairKey(row.artistKey, row.titleKey)),
      );
      const fresh = rows.filter(({ fetchedAt }) => now() - fetchedAt < STALE_AFTER_MS);
      const freshArtists = new Set(fresh.filter(({ kind }) => kind === 'artist').map(({ artistKey: key }) => key));
      const freshTracks = new Set(
        fresh.filter(({ kind }) => kind === 'track').map((row) => pairKey(row.artistKey, row.titleKey)),
      );
      return { artistsByKey, tracksByKey, askedArtists, askedTracks, freshArtists, freshTracks };
    });
  }

  async function lookUpArtist(name: string, knownId: string | null, folder: string | null): Promise<Result<void>> {
    if (script() !== null) {
      const similar = await byScript.similarArtists(name);
      if (!similar.ok) return similar;
      const saved = library.folder() === folder;
      return saved ? queries(({ saveArtist }) => saveArtist(name, null, similar.value, SCRIPT_SOURCE, now())) : ok();
    }
    const id = knownId === null ? await client.artistId(name) : ok(knownId);
    if (!id.ok) return id;
    const similar = id.value === null ? ok([]) : await client.similarArtists(id.value);
    if (!similar.ok) return similar;
    if (library.folder() === folder) {
      const saved = queries(({ saveArtist }) => saveArtist(name, id.value, similar.value, LISTENBRAINZ, now()));
      if (!saved.ok) return saved;
    }
    return ok();
  }

  async function lookUpTrack(track: TrackName, folder: string | null): Promise<Result<void>> {
    if (script() !== null) {
      const similar = await byScript.similarTracks(track.artist, track.title);
      if (!similar.ok) return similar;
      const saved = library.folder() === folder;
      return saved ? queries(({ saveTrack }) => saveTrack(track, similar.value, SCRIPT_SOURCE, now())) : ok();
    }
    const ids = await client.recordingIds(track.artist, track.title);
    if (!ids.ok) return ids;
    const similar = ids.value.length === 0 ? ok([]) : await client.similarTracks(ids.value);
    if (!similar.ok) return similar;
    if (library.folder() === folder) {
      const saved = queries(({ saveTrack }) => saveTrack(track, similar.value, LISTENBRAINZ, now()));
      if (!saved.ok) return saved;
    }
    return ok();
  }

  async function run(
    onProgress: (progress: DatasetProgress) => void,
    isCancelled: () => boolean,
  ): Promise<DatasetOutcome> {
    const planned = plan();
    if (!planned.ok) return { note: planned.error.message };
    const { artistsByKey, tracksByKey, askedArtists, freshArtists, freshTracks } = planned.value;
    const folder = library.folder();

    const artistsToAsk = [...artistsByKey].filter(([key]) => !freshArtists.has(key));
    const tracksToAsk = [...tracksByKey].filter(([key]) => !freshTracks.has(key));
    const total = artistsToAsk.length + tracksToAsk.length;
    let done = 0;
    let failed = 0;
    let failuresInARow = 0;
    let sinceAnnounced = 0;
    let isUnreachable = false;

    const counted = (result: Result<void>) => {
      if (result.ok) {
        done += 1;
        failuresInARow = 0;
      } else {
        failed += 1;
        failuresInARow += 1;
        log.warn('A listener data lookup failed', result.error.message);
        if (failuresInARow >= GIVE_UP_AFTER_FAILURES_IN_A_ROW) isUnreachable = true;
      }
      onProgress({ done, failed, total });
      sinceAnnounced += 1;
      if (sinceAnnounced >= ANNOUNCE_EVERY) {
        sinceAnnounced = 0;
        library.markChanged();
        announce();
      }
      return !isCancelled() && !isUnreachable && library.folder() === folder;
    };

    onProgress({ done, failed, total });
    // Artists first: they're a few minutes and most of the value, and tracks take hours.
    await eachAtOnce(artistsToAsk, CONCURRENT_LOOKUPS, async ([key, name]) =>
      counted(await lookUpArtist(name, askedArtists.get(key)?.mbid ?? null, folder)),
    );
    if (!isCancelled() && !isUnreachable) {
      await eachAtOnce(tracksToAsk, CONCURRENT_LOOKUPS, async ([, track]) => counted(await lookUpTrack(track, folder)));
    }

    library.markChanged();
    announce();
    if (isUnreachable) return { note: CANT_REACH };
    return {
      note: failed > 0 ? `${failed.toLocaleString('en')} couldn't be looked up, and will be tried next time` : null,
    };
  }

  return {
    counts() {
      const planned = plan();
      if (!planned.ok) return planned;
      const { artistsByKey, tracksByKey, askedArtists, askedTracks } = planned.value;
      const artistsDone = [...artistsByKey.keys()].filter((key) => askedArtists.has(key)).length;
      const tracksDone = [...tracksByKey.keys()].filter((key) => askedTracks.has(key)).length;
      const artists = `${artistsDone.toLocaleString('en')} of ${artistsByKey.size.toLocaleString('en')} artists`;
      const tracks = `${tracksDone.toLocaleString('en')} of ${tracksByKey.size.toLocaleString('en')} tracks`;
      return ok({
        done: artistsDone + tracksDone,
        missing: artistsByKey.size + tracksByKey.size - artistsDone - tracksDone,
        detail: `${artists}, ${tracks}`,
      });
    },
    problem() {
      // A script stands in for both, and goes on and off with ListenBrainz's switch, where it's kept.
      const asked = script() === null ? (['musicbrainz', 'listenbrainz'] as const) : (['listenbrainz'] as const);
      const off = asked.find((service) => !isOn(service));
      return off === undefined ? null : offWords(off);
    },
    start(onProgress) {
      let cancelled = false;
      return ok({
        cancel: () => {
          cancelled = true;
        },
        finished: run(onProgress, () => cancelled),
      });
    },
  };
}
