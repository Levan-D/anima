/* Shapes that cross IPC. "No value" is always null, and optional fields don't exist here. */

import type { AppError } from './result';

export type Track = {
  id: number;
  title: string;
  artistId: number;
  artist: string;
  albumId: number | null;
  album: string | null;
  albumArtist: string | null;
  year: number | null;
  discNumber: number | null;
  trackNumber: number | null;
  /** Length of this track. For a CUE track, its range, not the whole file. */
  durationMs: number;
  artHash: string | null;
  artColor: string | null;
  genres: string[];
  codec: string;
  sampleRate: number | null;
  bitDepth: number | null;
  channels: number | null;
  /** The file's average, size over length, so it's stable and counts its tags too. */
  bitrateKbps: number | null;
  isCueTrack: boolean;
  isMissing: boolean;
  /** For display only. Commands take ids, never paths. */
  relPath: string;
};

export type ArtistSummary = {
  id: number;
  name: string;
  albumCount: number;
  trackCount: number;
  artHash: string | null;
};

export type AlbumSummary = {
  id: number;
  title: string;
  artistId: number;
  artist: string;
  year: number | null;
  artHash: string | null;
  artColor: string | null;
  trackCount: number;
  durationMs: number;
};

export type GenreSummary = {
  id: number;
  name: string;
  trackCount: number;
};

export type TrackFilter =
  | { kind: 'all' }
  | { kind: 'artist'; artistId: number }
  | { kind: 'album'; albumId: number }
  | { kind: 'genre'; genreId: number }
  | { kind: 'missing' };

export type SearchResults = {
  artists: ArtistSummary[];
  albums: AlbumSummary[];
  tracks: Track[];
  /** Each list stops at a limit, and this says whether there was more. */
  more: { artists: boolean; albums: boolean; tracks: boolean };
};

export type DbProblem = 'damaged' | 'not-ours' | 'lost' | 'migration-failed';

export type LibraryStatus =
  | { state: 'no-folder' }
  | { state: 'folder-missing'; folder: string }
  | { state: 'not-writable'; folder: string; message: string }
  | {
      state: 'db-corrupt';
      folder: string;
      cause: DbProblem;
      /** When the newest usable backup was made, or null when there's none. */
      backupAt: number | null;
      message: string;
    }
  | { state: 'db-too-new'; folder: string }
  | {
      state: 'ready';
      folder: string;
      isEmpty: boolean;
      lastChanged: LastChanged | null;
      /** True when another machine wrote the database last, so this copy came from there. */
      changedElsewhere: boolean;
    };

export type LastChanged = {
  host: string;
  at: number;
};

export const SCAN_PHASES = ['idle', 'walking', 'reading', 'hashing', 'writing', 'art'] as const;
export type ScanPhase = (typeof SCAN_PHASES)[number];

export type ScanState = {
  phase: ScanPhase;
  filesFound: number;
  filesDone: number;
  currentPath: string | null;
  lastReport: ScanReport | null;
};

export type ScanReport = {
  finishedAt: number;
  durationMs: number;
  cancelled: boolean;
  /** Nothing was found while the database has files, so nothing was marked missing. */
  looksEmpty: boolean;
  added: number;
  updated: number;
  moved: number;
  nowMissing: number;
  restored: number;
  unchanged: number;
  issues: number;
};

export const SCAN_ISSUE_KINDS = ['unreadable', 'bad_tags', 'bad_cue', 'cue_file_missing', 'no_audio'] as const;
export type ScanIssueKind = (typeof SCAN_ISSUE_KINDS)[number];

export type ScanIssue = {
  relPath: string;
  kind: ScanIssueKind;
  message: string;
};

export const OUTPUT_MODES = ['shared', 'exclusive'] as const;
export type OutputMode = (typeof OUTPUT_MODES)[number];

export const REPLAY_GAIN_MODES = ['off', 'track', 'album'] as const;
export type ReplayGainMode = (typeof REPLAY_GAIN_MODES)[number];

export const PLAYER_STATUSES = ['idle', 'loading', 'playing', 'paused', 'ended', 'error', 'unavailable'] as const;
export type PlayerStatus = (typeof PLAYER_STATUSES)[number];

export const EQ_MAX_BANDS = 10;
export const EQ_MIN_HZ = 20;
export const EQ_MAX_HZ = 20_000;
export const EQ_MAX_GAIN_DB = 12;
export const EQ_MIN_PREAMP_DB = -24;
export const EQ_MAX_PREAMP_DB = 6;
export const EQ_MIN_Q = 0.1;
export const EQ_MAX_Q = 10;

export const EQ_BAND_KINDS = ['peak', 'lowshelf', 'highshelf'] as const;
export type EqBandKind = (typeof EQ_BAND_KINDS)[number];

export type EqBand = {
  id: number;
  kind: EqBandKind;
  frequencyHz: number;
  gainDb: number;
  q: number;
};

export type EqPreamp = {
  /** The headroom worked out from the curve, or `db` as set by hand. */
  auto: boolean;
  /** Kept while auto is on, so unticking it has somewhere to come back to. */
  db: number;
};

export const EQ_AUTO_PREAMP: EqPreamp = { auto: true, db: 0 };

export type EqSettings = {
  enabled: boolean;
  bands: EqBand[];
  preamp: EqPreamp;
};

export type EqPreset = {
  /** Unique, whatever its case. */
  name: string;
  bands: EqBand[];
  preamp: EqPreamp;
};

/** The chart's layers behind the curve. */
export type EqLayers = {
  words: boolean;
  instruments: boolean;
  ear: boolean;
};

export const EQ_DEFAULT_LAYERS: EqLayers = { words: true, instruments: false, ear: false };

export type EqImport = {
  settings: AppSettings;
  /** How many of the file's bands asked for more gain than there is. */
  clampedBands: number;
};

export type AudioFormat = {
  sampleRate: number;
  format: string;
  channels: number;
};

const SAMPLE_FORMAT_WORDS: Record<string, string> = {
  u8: '8-bit',
  s16: '16-bit',
  s24: '24-bit',
  s32: '32-bit',
  s64: '64-bit',
  float: '32-bit float',
  double: '64-bit float',
};

/** `16-bit`, `32-bit float`. Planar and interleaved are the same samples in a different order, so they read the same. */
export function sampleFormatWords(format: string): string {
  return SAMPLE_FORMAT_WORDS[format.endsWith('p') ? format.slice(0, -1) : format] ?? format;
}

/** What's actually happening to the signal. Exclusive doesn't mean bit-perfect by itself. */
/** Untouched, changed by something I chose (EQ, ReplayGain, volume), or changed by the system whatever I chose. */
export type SignalKind = 'bit-perfect' | 'adjusted' | 'system';

export type SignalPath = {
  decoded: AudioFormat | null;
  output: AudioFormat | null;
  isBitPerfect: boolean;
  /** Null until there's a signal to say it of. */
  kind: SignalKind | null;
  /** Plain-language reasons it isn't, such as "EQ is on" or "Volume is below 100". */
  alterations: string[];
};

export type QueueItem = {
  /** Unique within the queue, so the same track can be queued twice. */
  queueId: number;
  track: Track;
};

/** Position has its own event, since it changes constantly. The queue is fetched by version. */
export type PlayerState = {
  loadId: number;
  status: PlayerStatus;
  current: Track | null;
  queueIndex: number | null;
  queueLength: number;
  queueVersion: number;
  durationMs: number;
  volume: number;
  muted: boolean;
  outputMode: OutputMode;
  replayGainMode: ReplayGainMode;
  eq: EqSettings;
  /** The queue tops itself up with similar owned tracks just before it would run out. A preference, off by default. */
  endless: boolean;
  radio: RadioState;
  signal: SignalPath;
  error: AppError | null;
};

/** `no-data`: nothing to go on anywhere. `nothing-close`: nothing near this seed. `ran-out`: radio had to stop picking. */
export type RadioProblem = 'no-data' | 'nothing-close' | 'ran-out';

export type RadioState = {
  /** Radio is what decides what plays next, rather than a list that was chosen. */
  isSource: boolean;
  /** Asked to take over, and waiting for the engine's answer. */
  isStarting: boolean;
  /** There's a queue from before radio took over that can come back. */
  hasSavedQueue: boolean;
  problem: RadioProblem | null;
  /** Oldest first. Empty unless radio is the source. */
  past: Track[];
  upNext: Track[];
};

/** What radio would play, without anything having changed. */
export type RadioPreview = {
  /** What it goes from: what's playing, or failing that a recent play or a sensible pick. */
  seed: Track | null;
  upNext: Track[];
  problem: RadioProblem | null;
};

export type PlayerPosition = {
  loadId: number;
  positionMs: number;
};

/** 'next' is the very front of the line of added tracks, and 'after-added' is the back of it, ahead of the rest of the list. */
export const ENQUEUE_PLACES = ['next', 'after-added'] as const;
export type EnqueuePlace = (typeof ENQUEUE_PLACES)[number];

export type PlaylistSummary = {
  id: number;
  name: string;
  trackCount: number;
  missingCount: number;
  durationMs: number;
  artHash: string | null;
  updatedAt: number;
};

export type PlaylistItem = {
  itemId: number;
  track: Track;
};

export type PlaylistDetail = PlaylistSummary & {
  /** In order. Missing tracks stay in here with `track.isMissing`; the UI separates them. */
  items: PlaylistItem[];
};

export type LyricLine = {
  timeMs: number;
  text: string;
};

/** `chosen` and `own_file` are the person's own pick for this track, ahead of everything else. */
export const LYRICS_SOURCES = ['sidecar', 'embedded', 'lrclib', 'chosen', 'own_file'] as const;
export type LyricsSource = (typeof LYRICS_SOURCES)[number];

/** A record to choose from. Never the words themselves. */
export type LyricsSearchHit = {
  id: number;
  title: string;
  artist: string;
  album: string | null;
  durationMs: number;
  kind: 'synced' | 'plain' | 'instrumental';
};

export type Lyrics =
  | {
      status: 'found';
      source: LyricsSource;
      /** In time order. Empty text marks where a line ends, and isn't shown. Lines on one stamp share a line, split by \n. */
      synced: LyricLine[] | null;
      plain: string | null;
      /** The hand nudge. Positive shows them later. */
      offsetMs: number;
    }
  | { status: 'instrumental' }
  | { status: 'none' }
  /** LRCLIB couldn't be reached. It'll be tried again next time. */
  | { status: 'unavailable'; message: string };

export const LYRICS_OFFSET_MAX_MS = 600_000;

export type LyricsImportReport = {
  /** Found and instrumental rows in the file. */
  rows: number;
  /** not_found rows, which stay behind so the app can still ask LRCLIB. */
  leftBehind: number;
  /** Tracks in this library that one of the rows belongs to. */
  matched: number;
  added: number;
  /** Matched tracks that already had lyrics, and kept them. */
  kept: number;
};

export type WaveformData = {
  /** One byte per bucket: 0 is silence, 255 is full scale. Spans this track only. */
  peaks: Uint8Array;
  /** The same buckets, on the same scale: how loud each is on average. */
  rms: Uint8Array;
};

export type StatEntry = {
  id: number;
  name: string;
  subtitle: string | null;
  artHash: string | null;
  plays: number;
  listenedMs: number;
};

export type StatsSummary = {
  totalPlays: number;
  totalListenedMs: number;
  firstPlayAt: number | null;
  topArtists: StatEntry[];
  topAlbums: StatEntry[];
  topTracks: StatEntry[];
  listenedByMonth: { month: string; listenedMs: number }[];
  library: {
    tracks: number;
    albums: number;
    artists: number;
    totalDurationMs: number;
    lossless: number;
    lossy: number;
  };
};

/** In the order "Update everything" runs them. */
export const DATASET_IDS = ['library', 'lyrics', 'fingerprints', 'listeners'] as const;
export type DatasetId = (typeof DATASET_IDS)[number];

export type DatasetState = {
  id: DatasetId;
  done: number;
  missing: number;
  /** More than the two numbers say, when there's something. */
  detail: string | null;
  lastRunAt: number | null;
  /** Null unless it's running. */
  progress: { done: number; failed: number; total: number } | null;
  /** Why it can't run at all. */
  problem: string | null;
  /** What the last run has to say for itself. */
  note: string | null;
};

export type DataState = {
  datasets: DatasetState[];
  isRunningAll: boolean;
};

export type SimilarList = {
  tracks: Track[];
  /** False when there are no fingerprints or listener data to go on, which an update would fix. */
  hasSignals: boolean;
};

export type DiscoverRecommender = {
  name: string;
  /** One of its albums' sleeves, since a suggestion has no art of its own. */
  artHash: string | null;
};

/** Names only: it isn't in the library, so nothing here can be played. */
export type DiscoverArtist = {
  key: string;
  name: string;
  /** Owned artists whose listeners also listen to this one. */
  recommenderCount: number;
  /** The closest few of them, closest first. */
  recommendedBy: DiscoverRecommender[];
  /** Inferred from who recommends it, since nothing says what it is. At most two, and none if they're untagged. */
  genres: string[];
  /** The ones known, most connected first. May well be empty. */
  tracks: string[];
};

/** An owned artist whose listeners also listen to a suggestion. */
export type DiscoverVoice = {
  artistId: number;
  name: string;
  artHash: string | null;
  /** 0 to 1, against the closest that artist's listeners go anywhere. */
  score: number;
};

export type DiscoverKnownTrack = {
  title: string;
  /** The owned tracks whose listeners lead here, closest first. */
  ledBy: { trackId: number; artistId: number; artist: string; title: string }[];
};

/** All that's held on one suggestion beyond what its row shows. */
export type DiscoverDetail = {
  /** Every one of them, closest first. */
  voices: DiscoverVoice[];
  /** Most connected first. */
  tracks: DiscoverKnownTrack[];
};

export type DiscoverGenre = {
  name: string;
  count: number;
};

export type DiscoverList = {
  artists: DiscoverArtist[];
  /** Most suggestions first. */
  genres: DiscoverGenre[];
  hasData: boolean;
};

export const UI_SCALE_MIN = 0.75;
/** Past this the column's header, tabs and transport would leave the list fewer than three rows at any window size. */
export const UI_SCALE_MAX = 2.25;

export const STAY_AWAKE_MODES = ['off', 'keep-running', 'screen-on'] as const;
export type StayAwakeMode = (typeof STAY_AWAKE_MODES)[number];

export type StayAwake = {
  pluggedIn: StayAwakeMode;
  onBattery: StayAwakeMode;
};

export const STAY_AWAKE_DEFAULT: StayAwake = { pluggedIn: 'keep-running', onBattery: 'keep-running' };

export type AppSettings = {
  libraryFolder: string | null;
  volume: number;
  muted: boolean;
  outputMode: OutputMode;
  replayGainMode: ReplayGainMode;
  eq: EqSettings;
  eqPresets: EqPreset[];
  /** The one last chosen or saved. The bands in `eq` may have moved on from it since. */
  eqPreset: string | null;
  eqLayers: EqLayers;
  /** Interface size multiplier, for couch distance on the TV. */
  uiScale: number;
  fetchLyricsOnline: boolean;
  /** Just before the queue runs out, the Player adds a few owned tracks that suit it. */
  endless: boolean;
  /** Held only while music is playing. */
  stayAwake: StayAwake;
};

export type StorageInfo = {
  libraryFolder: string | null;
  databasePath: string | null;
  databaseBytes: number | null;
  cachePath: string;
  cacheBytes: number;
  settingsPath: string;
  logsPath: string;
  counts: { tracks: number; albums: number; artists: number; missing: number };
  lastScanAt: number | null;
  lastChanged: LastChanged | null;
  thisMachine: string;
  engine: {
    mpvPath: string;
    mpvFound: boolean;
    mpvVersion: string | null;
    ffmpegPath: string;
    ffmpegFound: boolean;
    ffmpegVersion: string | null;
  };
};

export const REVEAL_TARGETS = ['library', 'database', 'cache', 'logs', 'settings'] as const;
export type RevealTarget = (typeof REVEAL_TARGETS)[number];

export const LOG_MESSAGE_MAX = 5_000;
export const LOG_STACK_MAX = 50_000;

/** The URL fragment that makes a window the mini player. */
export const MINI_WINDOW_HASH = '#/mini';

/** Which side of the mini's strip its queue opened on. */
export type MiniQueueSide = 'above' | 'below';

export type WindowState = {
  isFullscreen: boolean;
  isMiniPlayer: boolean;
  /** Minimized or hidden. The page can't tell by itself, because background throttling is off. */
  isHidden: boolean;
};

export type NoticeAction =
  { kind: 'reveal-track'; label: string; trackId: number } | { kind: 'open-storage'; label: string };

export type Notice = {
  id: number;
  level: 'info' | 'warning' | 'error';
  message: string;
  action: NoticeAction | null;
};

// Which cached reads an event makes stale.

export const CHANGE_SCOPES = ['library', 'playlists', 'stats', 'lyrics', 'recommendations'] as const;
export type ChangeScope = (typeof CHANGE_SCOPES)[number];

export const ART_SIZES = ['thumb', 'full'] as const;
export type ArtSize = (typeof ART_SIZES)[number];

export function artUrl(hash: string, size: ArtSize): string {
  return `art://${size}/${hash}`;
}
