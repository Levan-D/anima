import type { ChangeScope, TrackFilter } from '@shared/domain';

export type SimilarSource = { kind: 'track'; trackId: number } | { kind: 'playlist'; playlistId: number };

export type AlbumFilter = {
  artistId: number | null;
  genreId: number | null;
};

/** Every key under a scope starts with that scope's name, so invalidating `scopeKey(scope)` reaches them all. */
export function scopeKey(scope: ChangeScope): readonly [ChangeScope] {
  return [scope];
}

export const queryKeys = {
  status: ['status'],
  scan: ['scan'],
  settings: ['settings'],
  queue: (version: number) => ['queue', version],
  waveform: (trackId: number | null) => ['waveform', trackId],

  artists: ['library', 'artists'],
  artistsInGenre: (genreId: number) => ['library', 'artistsInGenre', genreId],
  artist: (artistId: number) => ['library', 'artist', artistId],
  albums: (filter: AlbumFilter) => ['library', 'albums', filter],
  album: (albumId: number) => ['library', 'album', albumId],
  genres: ['library', 'genres'],
  tracks: (filter: TrackFilter) => ['library', 'tracks', filter],
  search: (query: string) => ['library', 'search', query],
  issues: ['library', 'issues'],
  storage: ['library', 'storage'],

  playlists: ['playlists', 'list'],
  playlist: (playlistId: number) => ['playlists', 'detail', playlistId],

  lyrics: (trackId: number) => ['lyrics', 'track', trackId],

  stats: ['stats', 'summary'],

  report: ['report', 'summary'],
  reportTracks: (checkId: string) => ['report', 'tracks', checkId],

  similar: (source: SimilarSource) => ['recommendations', 'similar', source],
  discover: ['recommendations', 'discover'],
  discoverDetail: (key: string) => ['recommendations', 'discover', key],
  radioPreviews: ['recommendations', 'radio'],
  radioPreview: (trackId: number | null) => ['recommendations', 'radio', trackId],
  radioStartOptions: ['recommendations', 'radio-start'],

  data: ['data'],
} as const;

/** Everything that belongs to the open library, and means nothing once a different one is open. */
export const LIBRARY_DATA = [
  scopeKey('library'),
  scopeKey('playlists'),
  scopeKey('lyrics'),
  scopeKey('stats'),
  scopeKey('recommendations'),
  scopeKey('report'),
] as const;
