import { err, ok, type Result } from '@shared/result';
import type { HandlerGroup } from '@main/ipc';
import type { Library } from '@main/library/library';

function orNotFound<T>(result: Result<T | null>, what: string): Result<T> {
  if (!result.ok) return result;
  return result.value === null ? err('not_found', `That ${what} isn't in the library`) : ok(result.value);
}

export function libraryHandlers(library: Library) {
  return {
    'library.status': () => ok(library.status()),
    'library.chooseFolder': async () => ok(await library.chooseFolder()),
    'library.retryOpen': async () => ok(await library.retryOpen()),
    'library.restoreBackup': () => library.restoreBackup(),
    'library.rebuild': () => library.rebuild(),
    'library.artists': () => library.read((queries) => queries.artists()),
    'library.artist': ({ artistId }) =>
      orNotFound(
        library.read((queries) => queries.artist(artistId)),
        'artist',
      ),
    'library.albums': (filter) => library.read((queries) => queries.albums(filter)),
    'library.album': ({ albumId }) =>
      orNotFound(
        library.read((queries) => queries.album(albumId)),
        'album',
      ),
    'library.genres': () => library.read((queries) => queries.genres()),
    'library.tracks': ({ filter }) => library.read((queries) => queries.tracks(filter)),
    'library.search': ({ query }) => library.read((queries) => queries.search(query)),
    'library.removeMissing': () => library.removeMissing(),

    'scan.start': () => library.startScan(),
    'scan.cancel': () => {
      library.cancelScan();
      return ok();
    },
    'scan.state': () => ok(library.scanState()),
    'scan.issues': () => library.read((queries) => queries.issues()),
  } satisfies HandlerGroup;
}
