/*
 * Mood stations from main's side. The tuner works in name keys, which the search and check rounds hand it, so an example
 * outlasts a rescan as a theme mark does. The worker does the fitting, and this keeps what it worked out.
 */

import type { EventPayload } from '@shared/ipc/contract';
import type { EventName } from '@shared/ipc/channels';
import { mainGenreOf } from '@shared/genres';
import { err, ok, type Result } from '@shared/result';
import type { MoodCheck, MoodFind, MoodStation, MoodTry } from '@shared/stations';
import type { HandlerGroup } from '@main/ipc';
import type { Library } from '@main/library/library';
import { artistKey } from '@main/library/names';
import { moodQueries } from './moodStore';
import type { MoodAsk } from './moodWork';
import type { Recommender } from './recommender';
import { albumMarkKey, trackMarkKey } from './themes';

const GENRES_FOUND = 5;
const SUPERSEDED = 'A newer change took its place';

type Deps = {
  library: Pick<Library, 'perConnection' | 'read' | 'tracksByIds'>;
  recommender: Pick<Recommender, 'moodTry' | 'moodGrade' | 'moodFit' | 'moodCards'>;
  emit: <E extends EventName>(event: E, payload: EventPayload<E>) => void;
  now: () => number;
};

const songLabel = (title: string, by: string) => `${title} – ${by}`;

/** For the worker to keep a model it had to work out again. */
export function keepMoodModel(library: Pick<Library, 'perConnection'>) {
  const store = library.perConnection(moodQueries);
  return (stationId: number, model: Float64Array, modelOf: string): void => {
    store(({ saveModel }) => saveModel(stationId, model, modelOf));
  };
}

export function moodStationHandlers({ library, recommender, emit, now }: Deps) {
  const store = library.perConnection(moodQueries);
  const announce = () => emit('library.changed', { scopes: ['recommendations'] });

  function search(text: string): Result<MoodFind[]> {
    return library.read((queries) => {
      const found = queries.search(text);
      const typed = text.trim().toLocaleLowerCase();
      const genres = new Map<string, number>();
      if (typed !== '') {
        for (const { name, trackCount } of queries.genres()) {
          const main = mainGenreOf(name);
          if (main.toLocaleLowerCase().includes(typed)) genres.set(main, (genres.get(main) ?? 0) + trackCount);
        }
      }
      return [
        ...[...genres]
          .toSorted((a, b) => b[1] - a[1])
          .slice(0, GENRES_FOUND)
          .map(([name, songs]): MoodFind => ({
            kind: 'genre',
            key: name,
            label: name,
            by: null,
            songs,
            artHash: null,
          })),
        ...found.artists.map(({ name, trackCount, artHash }): MoodFind => ({
          kind: 'artist',
          key: artistKey(name),
          label: name,
          by: null,
          songs: trackCount,
          artHash,
        })),
        ...found.albums.map(({ title, artist, artHash }): MoodFind => ({
          kind: 'album',
          key: albumMarkKey(title, artist),
          label: songLabel(title, artist),
          by: artist,
          songs: null,
          artHash,
        })),
        ...found.tracks.map(({ title, artist, artHash }): MoodFind => ({
          kind: 'track',
          key: trackMarkKey(title, artist),
          label: songLabel(title, artist),
          by: artist,
          songs: null,
          artHash,
        })),
      ];
    });
  }

  async function tryDraft(ask: MoodAsk, skipped: number[]): Promise<Result<MoodTry>> {
    const tried = await recommender.moodTry(ask, skipped);
    if (!tried.ok) return tried;
    const answer = tried.value;
    if (answer.problem === 'superseded') return err('superseded', SUPERSEDED);
    if (answer.problem !== null) return ok({ problem: answer.problem });
    const tracks = library.tracksByIds(answer.checkIds);
    if (!tracks.ok) return tracks;
    const check = tracks.value.map((track): MoodCheck => ({
      track,
      key: trackMarkKey(track.title, track.artist),
      label: songLabel(track.title, track.artist),
    }));
    const { checkIds: _, ...rest } = answer;
    return ok({ ...rest, check });
  }

  return {
    'moods.list': () => recommender.moodCards(),
    'moods.get': ({ stationId }) => {
      const found = store(({ get }) => get(stationId));
      if (!found.ok) return found;
      if (found.value === null) return err('not_found', 'That station is gone');
      const { model: _model, modelOf: _modelOf, ...station } = found.value;
      return ok(station satisfies MoodStation);
    },
    'moods.search': ({ text }) => search(text),
    'moods.try': ({ stationId, draft, skipped }) => tryDraft({ stationId, draft }, skipped),
    'moods.grade': async ({ stationId, draft }) => {
      const graded = await recommender.moodGrade({ stationId, draft }, (done, total) =>
        emit('moods.grading', { done, total }),
      );
      if (!graded.ok) return graded;
      return graded.value === null ? err('superseded', SUPERSEDED) : ok(graded.value);
    },
    'moods.save': async ({ stationId, draft }) => {
      const fitted = await recommender.moodFit({ stationId, draft });
      if (!fitted.ok) return fitted;
      if (fitted.value === null) return err('invalid_input', 'A station needs a yes example with songs in the library');
      const fit = fitted.value;
      const saved =
        stationId === null
          ? store(({ create }) => create(draft, fit, now()))
          : store(({ update }) => (update(stationId, draft, fit, now()) ? stationId : null));
      if (!saved.ok) return saved;
      if (saved.value === null) return err('not_found', 'That station is gone');
      announce();
      return ok({ stationId: saved.value });
    },
    'moods.delete': ({ stationId }) => {
      const removed = store(({ remove }) => remove(stationId));
      if (!removed.ok) return removed;
      announce();
      return ok();
    },
  } satisfies HandlerGroup;
}
