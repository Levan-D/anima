/*
 * The one contract between main and every window. A command is an input schema
 * (validated in main, because the renderer is untrusted) plus an output type.
 * Renderer code imports only the types from here, so zod stays out of its bundle.
 */
import * as z from 'zod';
import type {
  AlbumSummary,
  AppSettings,
  ArtistSummary,
  ChangeScope,
  GenreSummary,
  LibraryStatus,
  Lyrics,
  LyricsImportReport,
  Notice,
  PlayerPosition,
  PlayerState,
  PlaylistDetail,
  PlaylistSummary,
  QueueItem,
  ScanIssue,
  ScanState,
  SearchResults,
  StatsSummary,
  StorageInfo,
  Track,
  WaveformData,
  WindowState,
} from '@shared/domain';
import {
  ENQUEUE_PLACES,
  EQ_BAND_KINDS,
  EQ_MAX_BANDS,
  EQ_MAX_GAIN_DB,
  EQ_MAX_HZ,
  EQ_MAX_Q,
  EQ_MIN_HZ,
  EQ_MIN_Q,
  LOG_MESSAGE_MAX,
  LOG_STACK_MAX,
  LYRICS_OFFSET_MAX_MS,
  OUTPUT_MODES,
  REPLAY_GAIN_MODES,
  REVEAL_TARGETS,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
} from '@shared/domain';
import type { Result } from '@shared/result';
import type { CommandName, EventName } from './channels';

const id = z.int().positive();
const ids = z.array(id).max(100_000);
const index = z.int().nonnegative();
const none = z.void();
const playlistName = z.string().trim().min(1).max(200);

const trackFilter = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('all') }),
  z.strictObject({ kind: z.literal('artist'), artistId: id }),
  z.strictObject({ kind: z.literal('album'), albumId: id }),
  z.strictObject({ kind: z.literal('genre'), genreId: id }),
  z.strictObject({ kind: z.literal('missing') }),
]);

const eqBand = z.strictObject({
  id: z.int().nonnegative(),
  kind: z.enum(EQ_BAND_KINDS),
  frequencyHz: z.number().min(EQ_MIN_HZ).max(EQ_MAX_HZ),
  gainDb: z.number().min(-EQ_MAX_GAIN_DB).max(EQ_MAX_GAIN_DB),
  q: z.number().min(EQ_MIN_Q).max(EQ_MAX_Q),
});

export const eqSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  bands: z.array(eqBand).max(EQ_MAX_BANDS),
});

// Curried so the output type can be written while the input type is inferred.
const command =
  <Output>() =>
  <Input extends z.ZodType>(input: Input) => ({ input, output: undefined as unknown as Output });

export const commands = {
  'library.status': command<LibraryStatus>()(none),
  /** Opens the folder dialog in main. Returns the resulting status, unchanged if cancelled. */
  'library.chooseFolder': command<LibraryStatus>()(none),
  'library.retryOpen': command<LibraryStatus>()(none),
  'library.restoreBackup': command<LibraryStatus>()(none),
  /** Sets the unreadable database aside and starts a new one. Never deletes it. */
  'library.rebuild': command<LibraryStatus>()(none),
  'library.artists': command<ArtistSummary[]>()(none),
  'library.artist': command<ArtistSummary>()(z.strictObject({ artistId: id })),
  'library.albums': command<AlbumSummary[]>()(z.strictObject({ artistId: id.nullable(), genreId: id.nullable() })),
  'library.album': command<AlbumSummary>()(z.strictObject({ albumId: id })),
  'library.genres': command<GenreSummary[]>()(none),
  'library.tracks': command<Track[]>()(z.strictObject({ filter: trackFilter })),
  'library.search': command<SearchResults>()(z.strictObject({ query: z.string().max(200) })),
  /** Deliberate and destructive: also removes these tracks from playlists. The UI warns first. */
  'library.removeMissing': command<{ removed: number }>()(none),

  'scan.start': command<void>()(none),
  'scan.cancel': command<void>()(none),
  'scan.state': command<ScanState>()(none),
  'scan.issues': command<ScanIssue[]>()(none),

  'player.state': command<PlayerState>()(none),
  /** For a window that opens or reloads while paused, when no position event is on its way. */
  'player.position': command<PlayerPosition>()(none),
  'player.queue': command<QueueItem[]>()(none),
  'player.play': command<void>()(z.strictObject({ trackIds: ids, startIndex: index })),
  'player.playQueueIndex': command<void>()(z.strictObject({ index })),
  'player.toggle': command<void>()(none),
  'player.pause': command<void>()(none),
  'player.resume': command<void>()(none),
  'player.next': command<void>()(none),
  'player.previous': command<void>()(none),
  /** Relative to the current track's start. Out-of-range values are clamped. */
  'player.seek': command<void>()(z.strictObject({ positionMs: z.number().nonnegative() })),
  'player.setVolume': command<void>()(z.strictObject({ volume: z.number().min(0).max(100) })),
  'player.setMuted': command<void>()(z.strictObject({ muted: z.boolean() })),
  'player.setOutputMode': command<void>()(z.strictObject({ mode: z.enum(OUTPUT_MODES) })),
  'player.setReplayGainMode': command<void>()(z.strictObject({ mode: z.enum(REPLAY_GAIN_MODES) })),
  'player.setEq': command<void>()(z.strictObject({ eq: eqSettingsSchema })),
  'player.enqueue': command<void>()(z.strictObject({ trackIds: ids, where: z.enum(ENQUEUE_PLACES) })),
  'player.removeFromQueue': command<void>()(z.strictObject({ queueIds: ids })),
  'player.moveInQueue': command<void>()(z.strictObject({ queueId: id, toIndex: index })),
  'player.clearQueue': command<void>()(none),
  /** After a device or engine failure, tries again from where playback stopped. */
  'player.retry': command<void>()(none),

  'playlist.list': command<PlaylistSummary[]>()(none),
  'playlist.get': command<PlaylistDetail>()(z.strictObject({ playlistId: id })),
  'playlist.create': command<PlaylistSummary>()(z.strictObject({ name: playlistName, trackIds: ids })),
  'playlist.rename': command<void>()(z.strictObject({ playlistId: id, name: playlistName })),
  'playlist.delete': command<void>()(z.strictObject({ playlistId: id })),
  /** `index: null` adds to the end. */
  'playlist.addTracks': command<void>()(z.strictObject({ playlistId: id, trackIds: ids, index: index.nullable() })),
  'playlist.removeItems': command<void>()(z.strictObject({ playlistId: id, itemIds: ids })),
  /** Moves the items, keeping their relative order, so they start at `toIndex`. */
  'playlist.moveItems': command<void>()(z.strictObject({ playlistId: id, itemIds: ids, toIndex: index })),
  'playlist.removeMissing': command<{ removed: number }>()(z.strictObject({ playlistId: id })),

  'lyrics.get': command<Lyrics>()(z.strictObject({ trackId: id })),
  /** Ignores a remembered "not found" and asks LRCLIB again. */
  'lyrics.refresh': command<Lyrics>()(z.strictObject({ trackId: id })),
  /** On top of any [offset:] in the lyrics. Positive shows them later. */
  'lyrics.setOffset': command<void>()(
    z.strictObject({ trackId: id, offsetMs: z.int().min(-LYRICS_OFFSET_MAX_MS).max(LYRICS_OFFSET_MAX_MS) }),
  ),
  /** Opens the file dialog in main. Null if cancelled. */
  'lyrics.importLibrary': command<LyricsImportReport | null>()(none),

  /** Resolves once peaks exist, computing and caching them on first request. */
  'waveform.get': command<WaveformData | null>()(z.strictObject({ trackId: id })),

  'stats.summary': command<StatsSummary>()(none),

  'settings.get': command<AppSettings>()(none),
  /** One setting per call. */
  'settings.update': command<AppSettings>()(
    z.union([
      z.strictObject({ uiScale: z.number().min(UI_SCALE_MIN).max(UI_SCALE_MAX) }),
      z.strictObject({ fetchLyricsOnline: z.boolean() }),
    ]),
  ),

  'system.storageInfo': command<StorageInfo>()(none),
  'system.revealTrack': command<void>()(z.strictObject({ trackId: id })),
  'system.revealPath': command<void>()(z.strictObject({ target: z.enum(REVEAL_TARGETS) })),
  'system.logError': command<void>()(
    z.strictObject({ message: z.string().max(LOG_MESSAGE_MAX), stack: z.string().max(LOG_STACK_MAX).nullable() }),
  ),

  'window.state': command<WindowState>()(none),
  'window.setMiniPlayer': command<void>()(z.strictObject({ enabled: z.boolean() })),
  'window.toggleFullscreen': command<void>()(none),
} satisfies Record<CommandName, { input: z.ZodType; output: unknown }>;

export type Commands = typeof commands;
export type CommandInput<N extends CommandName> = z.input<Commands[N]['input']>;
export type CommandOutput<N extends CommandName> = Commands[N]['output'];
export type CommandResult<N extends CommandName> = Result<CommandOutput<N>>;

export type CommandArgs<N extends CommandName> = [CommandInput<N>] extends [void] ? [] : [input: CommandInput<N>];

export type Events = {
  'player.state': PlayerState;
  'player.position': PlayerPosition;
  'library.status': LibraryStatus;
  'library.changed': { scopes: ChangeScope[] };
  'scan.state': ScanState;
  'settings.changed': AppSettings;
  'window.state': WindowState;
  notice: Notice;
};

/** Keeps `Events` honest: every event name has to have a payload. */
export type EventPayload<E extends EventName> = Events[E];

export type Api = {
  invoke<N extends CommandName>(name: N, ...args: CommandArgs<N>): Promise<CommandResult<N>>;
  on<E extends EventName>(event: E, listener: (payload: EventPayload<E>) => void): () => void;
};
