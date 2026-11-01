/*
 * The one contract between main and every window. A command is an input schema
 * (validated in main, because the renderer is untrusted) plus an output type.
 * Renderer code imports only the types from here, so zod stays out of its bundle.
 */
import * as z from 'zod';
import type {
  AlbumSummary,
  AppSettings,
  EqImport,
  ArtistSummary,
  ChangeScope,
  DataState,
  DiscoverDetail,
  DiscoverList,
  GenreSummary,
  LibraryReport,
  LibraryStatus,
  Lyrics,
  LyricsImportReport,
  LyricsSearchHit,
  Notice,
  PlayerPosition,
  PlayerState,
  PlaylistDetail,
  PlaylistSummary,
  QueueItem,
  RadioPreview,
  RadioStartOptions,
  ScanIssue,
  ScanState,
  SearchResults,
  SimilarList,
  StatsSummary,
  StorageInfo,
  Track,
  WaveformData,
  WindowState,
} from '@shared/domain';
import {
  BLEND_MAX_PARTS,
  BLEND_MIN_PARTS,
  DATASET_IDS,
  ENQUEUE_PLACES,
  EQ_BAND_KINDS,
  EQ_MAX_BANDS,
  EQ_MAX_GAIN_DB,
  EQ_MAX_HZ,
  EQ_MAX_PREAMP_DB,
  EQ_MAX_Q,
  EQ_MIN_HZ,
  EQ_MIN_PREAMP_DB,
  EQ_MIN_Q,
  LOG_MESSAGE_MAX,
  LOG_STACK_MAX,
  LYRICS_OFFSET_MAX_MS,
  OUTPUT_MODES,
  REPLAY_GAIN_MODES,
  REVEAL_TARGETS,
  STAY_AWAKE_MODES,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
} from '@shared/domain';
import type { Result } from '@shared/result';
import type { CommandName, EventName } from './channels';
import { headphoneCommands } from './headphoneCommands';

const id = z.int().positive();
const ids = z.array(id).max(100_000);
const index = z.int().nonnegative();
const none = z.void();
const playlistName = z.string().trim().min(1).max(200);

const presetName = z.string().trim().min(1).max(100);

const wander = z.number().min(0).max(1);
const energy = z.number().min(0).max(1);
const radioStartFrom = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('track'), trackId: id }),
  z.strictObject({ kind: z.literal('genre'), genre: z.string().min(1).max(200) }),
  z.strictObject({ kind: z.literal('decade'), decade: z.int().min(1900).max(2100).multipleOf(10) }),
  z.strictObject({
    kind: z.literal('blend'),
    parts: z
      .array(z.strictObject({ kind: z.enum(['track', 'artist']), id }))
      .min(BLEND_MIN_PARTS)
      .max(BLEND_MAX_PARTS),
  }),
  z.strictObject({ kind: z.literal('forgotten') }),
  z.strictObject({ kind: z.literal('surprise'), randomSeed: z.int().nullable() }),
]);

const trackFilter = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('all') }),
  z.strictObject({ kind: z.literal('artist'), artistId: id }),
  z.strictObject({ kind: z.literal('album'), albumId: id }),
  z.strictObject({ kind: z.literal('genre'), genreId: id }),
  z.strictObject({ kind: z.literal('missing') }),
]);

export const eqBandSchema = z.strictObject({
  id: z.int().nonnegative(),
  kind: z.enum(EQ_BAND_KINDS),
  frequencyHz: z.number().min(EQ_MIN_HZ).max(EQ_MAX_HZ),
  gainDb: z.number().min(-EQ_MAX_GAIN_DB).max(EQ_MAX_GAIN_DB),
  q: z.number().min(EQ_MIN_Q).max(EQ_MAX_Q),
});

export const eqSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  bands: z.array(eqBandSchema).max(EQ_MAX_BANDS),
  preamp: z.strictObject({ auto: z.boolean(), db: z.number().min(EQ_MIN_PREAMP_DB).max(EQ_MAX_PREAMP_DB) }),
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
  /** Whoever plays on or is the album artist of a track in it. The counts are the artist's whole, not just in this genre. */
  'library.artistsInGenre': command<ArtistSummary[]>()(z.strictObject({ genreId: id })),
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

  /** Also starts filling in what it needs that was never read. */
  'report.get': command<LibraryReport>()(none),
  /** In the order that suits the check. */
  'report.tracks': command<Track[]>()(z.strictObject({ checkId: z.string().max(100) })),

  'player.state': command<PlayerState>()(none),
  /** For a window that opens or reloads while paused, when no position event is on its way. */
  'player.position': command<PlayerPosition>()(none),
  'player.queue': command<QueueItem[]>()(none),
  'player.play': command<void>()(z.strictObject({ trackIds: ids, startIndex: index })),
  'player.playQueueIndex': command<void>()(z.strictObject({ index })),
  'player.toggle': command<void>()(none),
  'player.pause': command<void>()(none),
  'player.resume': command<void>()(none),
  'player.stop': command<void>()(none),
  'player.next': command<void>()(none),
  'player.previous': command<void>()(none),
  /** Relative to the current track's start. Out-of-range values are clamped. */
  'player.seek': command<void>()(z.strictObject({ positionMs: z.number().nonnegative() })),
  'player.setVolume': command<void>()(z.strictObject({ volume: z.number().min(0).max(100) })),
  'player.setMuted': command<void>()(z.strictObject({ muted: z.boolean() })),
  'player.setOutputMode': command<void>()(z.strictObject({ mode: z.enum(OUTPUT_MODES) })),
  'player.setReplayGainMode': command<void>()(z.strictObject({ mode: z.enum(REPLAY_GAIN_MODES) })),
  'player.setEq': command<void>()(z.strictObject({ eq: eqSettingsSchema })),
  'player.setEndless': command<void>()(z.strictObject({ on: z.boolean() })),
  'player.enqueue': command<void>()(z.strictObject({ trackIds: ids, where: z.enum(ENQUEUE_PLACES) })),
  'player.removeFromQueue': command<void>()(z.strictObject({ queueIds: ids })),
  'player.moveInQueue': command<void>()(z.strictObject({ queueIds: ids, toIndex: index })),
  'player.clearQueue': command<void>()(none),
  /** After a device or engine failure, tries again from where playback stopped. */
  'player.retry': command<void>()(none),

  /** What radio would play from here. Changes nothing. Its state as the source is in `player.state`. */
  'radio.preview': command<RadioPreview>()(none),
  /** Radio becomes what plays next, from this track, or null for from what's playing. The queue is kept for coming back. */
  'radio.play': command<void>()(z.strictObject({ trackId: id.nullable() })),
  /** Radio from a description instead of a track, replacing what's ahead. The worker works out where that is. */
  'radio.start': command<void>()(z.strictObject({ from: radioStartFrom, wander })),
  /** What the Tune in drawer can offer. */
  'radio.startOptions': command<RadioStartOptions>()(none),
  /** Remembered, and radio's own unplayed picks are made again with it. */
  'radio.setWander': command<void>()(z.strictObject({ wander })),
  /** The same, for how calm or intense it should be. */
  'radio.setEnergy': command<void>()(z.strictObject({ energy })),
  /** The queue from before radio took over, paused at its place, with nothing opened until Play. */
  'radio.backToQueue': command<void>()(none),

  'playlist.list': command<PlaylistSummary[]>()(none),
  'playlist.get': command<PlaylistDetail>()(z.strictObject({ playlistId: id })),
  'playlist.create': command<PlaylistSummary>()(z.strictObject({ name: playlistName, trackIds: ids })),
  'playlist.rename': command<void>()(z.strictObject({ playlistId: id, name: playlistName })),
  'playlist.delete': command<void>()(z.strictObject({ playlistId: id })),
  /** `index: null` adds to the end. A track already in the playlist is left out, and `added` doesn't count it. */
  'playlist.addTracks': command<{ added: number }>()(
    z.strictObject({ playlistId: id, trackIds: ids, index: index.nullable() }),
  ),
  'playlist.removeItems': command<void>()(z.strictObject({ playlistId: id, itemIds: ids })),
  /** Moves the items, keeping their relative order, so they start at `toIndex`. */
  'playlist.moveItems': command<void>()(z.strictObject({ playlistId: id, itemIds: ids, toIndex: index })),
  'playlist.removeMissing': command<{ removed: number }>()(z.strictObject({ playlistId: id })),

  'lyrics.get': command<Lyrics>()(z.strictObject({ trackId: id })),
  /** Asks LRCLIB again, whatever is remembered. Lyrics it finds replace even the person's own pick, so only they ask. */
  'lyrics.refresh': command<Lyrics>()(z.strictObject({ trackId: id })),
  /** On top of any [offset:] in the lyrics. Positive shows them later. */
  'lyrics.setOffset': command<void>()(
    z.strictObject({ trackId: id, offsetMs: z.int().min(-LYRICS_OFFSET_MAX_MS).max(LYRICS_OFFSET_MAX_MS) }),
  ),
  /** Opens the file dialog in main. Null if cancelled. */
  'lyrics.importLibrary': command<LyricsImportReport | null>()(none),
  'lyrics.search': command<LyricsSearchHit[]>()(z.strictObject({ query: z.string().trim().min(1).max(200) })),
  /** Saves that LRCLIB record for this track, ahead of every other source, and drops the nudge. */
  'lyrics.choose': command<void>()(z.strictObject({ trackId: id, recordId: id })),
  /** Opens the file dialog in main, and saves the file like a choice. False if cancelled. */
  'lyrics.loadFile': command<boolean>()(z.strictObject({ trackId: id })),
  /** Forgets this track's stored lyrics and nudge. The next `lyrics.get` goes through the usual order. */
  'lyrics.clear': command<void>()(z.strictObject({ trackId: id })),
  /** Shows the .lrc beside the file when that's what's showing, and otherwise the track's own file. */
  'lyrics.reveal': command<void>()(z.strictObject({ trackId: id })),

  /** Resolves once peaks exist, computing and caching them on first request. */
  'waveform.get': command<WaveformData | null>()(z.strictObject({ trackId: id })),

  'stats.summary': command<StatsSummary>()(none),

  'recommend.similarToTrack': command<SimilarList>()(z.strictObject({ trackId: id })),
  'recommend.similarToPlaylist': command<SimilarList>()(z.strictObject({ playlistId: id })),
  'recommend.discover': command<DiscoverList>()(none),
  /** By the `key` of a suggestion in that list. A name that's no longer linked to anything gets empty lists. */
  'recommend.discoverDetail': command<DiscoverDetail>()(z.strictObject({ key: z.string().min(1).max(1_000) })),

  'data.state': command<DataState>()(none),
  /** Starts it, and says how it goes through `data.state`. Refused with the reason when it can't run at all. */
  'data.update': command<void>()(z.strictObject({ dataset: z.enum(DATASET_IDS) })),
  'data.updateAll': command<void>()(none),
  /** Asks again about everything that's already been asked. */
  'data.refreshListeners': command<void>()(none),
  /** Null stops everything that's running, and whatever "Update everything" had left. */
  'data.cancel': command<void>()(z.strictObject({ dataset: z.enum(DATASET_IDS).nullable() })),

  'settings.get': command<AppSettings>()(none),
  /** One setting per call. */
  'settings.update': command<AppSettings>()(
    z.union([
      z.strictObject({ uiScale: z.number().min(UI_SCALE_MIN).max(UI_SCALE_MAX) }),
      z.strictObject({ fetchLyricsOnline: z.boolean() }),
      z.strictObject({
        eqLayers: z.strictObject({ words: z.boolean(), instruments: z.boolean(), ear: z.boolean() }),
      }),
      z.strictObject({
        stayAwake: z.strictObject({ pluggedIn: z.enum(STAY_AWAKE_MODES), onBattery: z.enum(STAY_AWAKE_MODES) }),
      }),
    ]),
  ),

  'system.storageInfo': command<StorageInfo>()(none),
  'system.revealTrack': command<void>()(z.strictObject({ trackId: id })),
  'system.revealPath': command<void>()(z.strictObject({ target: z.enum(REVEAL_TARGETS) })),
  'system.logError': command<void>()(
    z.strictObject({ message: z.string().max(LOG_MESSAGE_MAX), stack: z.string().max(LOG_STACK_MAX).nullable() }),
  ),

  /** Sets the EQ to it at once. */
  'eq.applyPreset': command<AppSettings>()(z.strictObject({ name: presetName })),
  /** No preset, and flat. Whether the EQ is on stays as it is. */
  'eq.clearPreset': command<AppSettings>()(none),
  /** The current EQ, under a name no other preset has, whatever its case. */
  'eq.createPreset': command<AppSettings>()(z.strictObject({ name: presetName })),
  /** Over an existing one, with the current EQ. */
  'eq.savePreset': command<AppSettings>()(z.strictObject({ name: presetName })),
  'eq.renamePreset': command<AppSettings>()(z.strictObject({ name: presetName, newName: presetName })),
  'eq.deletePreset': command<AppSettings>()(z.strictObject({ name: presetName })),
  /** Opens the file dialog in main, and applies what it reads. Null if cancelled. */
  'eq.importPreset': command<EqImport | null>()(none),
  /** Opens the save dialog in main. False if cancelled. */
  'eq.exportPreset': command<boolean>()(z.strictObject({ name: presetName })),

  ...headphoneCommands,

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
  'data.state': DataState;
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
