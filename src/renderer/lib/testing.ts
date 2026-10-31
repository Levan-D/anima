/* Stand-ins for what component tests don't have: main on the other end of IPC, and a layout engine. */

import { vi } from 'vitest';
import type {
  AlbumSummary,
  ArtistSummary,
  GenreSummary,
  LibraryStatus,
  PlayerState,
  ScanReport,
  ScanState,
  SearchResults,
  StorageInfo,
  Track,
} from '@shared/domain';
import type { CommandName, EventName } from '@shared/ipc/channels';
import type { CommandInput, CommandOutput, EventPayload } from '@shared/ipc/contract';
import { err, ok, type ErrorCode, type Result } from '@shared/result';
import { forgetAllLists } from '@/lib/listMemory';
import { resetNavigation } from '@/lib/navigation';
import { resetPlayerPosition } from '@/lib/playerPosition';
import { IDLE_PLAYER, setPlayerState } from '@/lib/playerStore';
import { queryClient } from '@/lib/queryClient';

type Reply<N extends CommandName> = CommandOutput<N> | { failure: ErrorCode; message: string };
type Replies = { [N in CommandName]?: Reply<N> | ((input: CommandInput<N>) => Reply<N> | Promise<Reply<N>>) };

export type StubbedApi = {
  invoke: ReturnType<typeof vi.fn>;
  emit: <E extends EventName>(event: E, payload: EventPayload<E>) => void;
};

function toResult(reply: unknown): Result<unknown> {
  if (typeof reply === 'object' && reply !== null && 'failure' in reply) {
    const { failure, message } = reply as { failure: ErrorCode; message: string };
    return err(failure, message);
  }
  return ok(reply);
}

/** Answers commands from a table. A command that isn't in it fails, so a test can't pass by asking for nothing. */
export function stubApi(replies: Replies = {}): StubbedApi {
  const listeners = new Map<string, Set<(payload: never) => void>>();

  const invoke = vi.fn((name: CommandName, input?: unknown) => {
    if (!(name in replies)) return Promise.resolve(err('unexpected', `Nothing stubbed for ${name}`));
    const reply = (replies as Record<string, unknown>)[name];
    return Promise.resolve(typeof reply === 'function' ? (reply as (given: unknown) => unknown)(input) : reply).then(
      toResult,
    );
  });

  const on = vi.fn((event: string, listener: (payload: never) => void) => {
    const set = listeners.get(event) ?? new Set();
    set.add(listener);
    listeners.set(event, set);
    return () => set.delete(listener);
  });

  vi.stubGlobal('api', { invoke, on });
  return {
    invoke,
    emit(event, payload) {
      for (const listener of listeners.get(event) ?? []) (listener as (value: typeof payload) => void)(payload);
    },
  };
}

/** Gives every element a size, since jsdom has no layout. The list then has room for a screenful. */
export function stubLayout({ width = 480, height = 800 } = {}): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    bottom: height,
    right: width,
    width,
    height,
    toJSON: () => ({}),
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(height);
}

/** Everything these tests share lives in modules, so each test starts by putting it back. */
export function resetRendererState(): void {
  queryClient.clear();
  resetNavigation();
  forgetAllLists();
  resetPlayerPosition();
  setPlayerState(IDLE_PLAYER);
}

/** A state for the store, as if main had sent it. */
export function playerStateWith(overrides: Partial<PlayerState> = {}): PlayerState {
  return { ...IDLE_PLAYER, ...overrides };
}

export const READY: Extract<LibraryStatus, { state: 'ready' }> = {
  state: 'ready',
  folder: 'D:\\Music',
  isEmpty: false,
  lastChanged: { host: 'THIS-PC', at: 1_700_000_000_000 },
  changedElsewhere: false,
};

export const IDLE_SCAN: ScanState = { phase: 'idle', filesFound: 0, filesDone: 0, currentPath: null, lastReport: null };

export const NOTHING_FOUND: SearchResults = {
  artists: [],
  albums: [],
  tracks: [],
  more: { artists: false, albums: false, tracks: false },
};

export function scanReport(overrides: Partial<ScanReport> = {}): ScanReport {
  return {
    finishedAt: 1_700_000_000_000,
    durationMs: 1_000,
    cancelled: false,
    looksEmpty: false,
    added: 0,
    updated: 0,
    moved: 0,
    nowMissing: 0,
    restored: 0,
    unchanged: 0,
    issues: 0,
    ...overrides,
  };
}

export function track(overrides: Partial<Track> = {}): Track {
  return {
    id: 1,
    title: 'Jóga',
    artistId: 1,
    artist: 'Björk',
    albumId: 1,
    album: 'Homogenic',
    albumArtist: 'Björk',
    year: 1997,
    discNumber: 1,
    trackNumber: 1,
    durationMs: 305_000,
    artHash: 'a'.repeat(40),
    artColor: null,
    genres: ['Electronic'],
    codec: 'flac',
    sampleRate: 44_100,
    bitDepth: 16,
    isCueTrack: false,
    isMissing: false,
    relPath: 'Björk/Homogenic/01 Jóga.flac',
    ...overrides,
  };
}

export function album(overrides: Partial<AlbumSummary> = {}): AlbumSummary {
  return {
    id: 1,
    title: 'Homogenic',
    artistId: 1,
    artist: 'Björk',
    year: 1997,
    artHash: 'a'.repeat(40),
    artColor: null,
    trackCount: 10,
    durationMs: 2_600_000,
    ...overrides,
  };
}

export function artist(overrides: Partial<ArtistSummary> = {}): ArtistSummary {
  return { id: 1, name: 'Björk', albumCount: 1, trackCount: 10, artHash: 'a'.repeat(40), ...overrides };
}

export function genre(overrides: Partial<GenreSummary> = {}): GenreSummary {
  return { id: 1, name: 'Electronic', trackCount: 274, ...overrides };
}

export function storageInfo(overrides: Partial<StorageInfo> = {}): StorageInfo {
  return {
    libraryFolder: 'D:\\Music',
    databasePath: 'D:\\Music\\.player\\library.db',
    databaseBytes: 4_718_592,
    cachePath: 'C:\\AppData\\art-cache',
    cacheBytes: 454_000_000,
    settingsPath: 'C:\\AppData\\settings.json',
    logsPath: 'C:\\AppData\\logs',
    counts: { tracks: 5_719, albums: 682, artists: 412, missing: 0 },
    lastScanAt: 1_700_000_000_000,
    lastChanged: { host: 'THIS-PC', at: 1_700_000_000_000 },
    thisMachine: 'THIS-PC',
    engine: {
      mpvPath: 'C:\\app\\mpv.exe',
      mpvFound: true,
      mpvVersion: 'v0.41.0',
      ffmpegPath: 'C:\\app\\ffmpeg.exe',
      ffmpegFound: true,
      ffmpegVersion: '6.0',
    },
    ...overrides,
  };
}
