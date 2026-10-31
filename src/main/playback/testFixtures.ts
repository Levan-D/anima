/* Stand-ins for the Player's tests: a track, a library, and an mpv that does as it's told and says what the test says. */

import type { AppSettings, LibraryStatus, Notice, PlayerPosition, PlayerState, Track } from '@shared/domain';
import { err, ok, type Result } from '@shared/result';
import type { PlayableTrack, TrackRange } from '@main/library/queries';
import { DEFAULT_SETTINGS } from '@main/settings/settings';
import type { SpawnMpv } from './mpvProcess';
import { createPlayer, type Player, type PlayerDeps } from './player';

export function makeTrack(id: number, overrides: Partial<Track> = {}): Track {
  return {
    id,
    title: `Track ${id}`,
    artistId: 1,
    artist: 'Artist',
    albumId: 1,
    album: 'Album',
    albumArtist: 'Artist',
    year: 2000,
    discNumber: 1,
    trackNumber: id,
    durationMs: 200_000,
    artHash: null,
    artColor: null,
    genres: [],
    codec: 'FLAC',
    sampleRate: 44_100,
    bitDepth: 16,
    isCueTrack: false,
    isMissing: false,
    relPath: `Artist/Album/${id}.flac`,
    ...overrides,
  };
}

/** A whole file of its own, unless told otherwise. */
export function makePlayable(id: number, range: Partial<TrackRange> = {}, track: Partial<Track> = {}): PlayableTrack {
  return {
    track: makeTrack(id, track),
    range: { fileId: id, startMs: 0, endMs: null, ...range },
  };
}

const READY: LibraryStatus = {
  state: 'ready',
  folder: 'D:\\Music',
  isEmpty: false,
  lastChanged: null,
  changedElsewhere: false,
};

export type FakeLibrary = PlayerDeps['library'] & {
  setStatus(next: LibraryStatus): void;
  missing: number[];
};

export function makeLibrary(tracks: PlayableTrack[], pathOf?: (trackId: number) => string | null): FakeLibrary {
  const byId = new Map(tracks.map((playable) => [playable.track.id, playable]));
  const pretendPath = (trackId: number) => (byId.has(trackId) ? `D:\\Music\\${trackId}.flac` : null);
  const listeners = new Set<(status: LibraryStatus) => void>();
  const missing: number[] = [];
  let status = READY;
  return {
    missing,
    status: () => status,
    onStatus(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setStatus(next) {
      status = next;
      for (const listener of listeners) listener(next);
    },
    playableTracks(ids): Result<PlayableTrack[]> {
      if (status.state !== 'ready') return err('no_library', "The library isn't open");
      return ok(ids.flatMap((id) => byId.get(id) ?? []));
    },
    absolutePath: pathOf ?? pretendPath,
    markMissing(trackId) {
      missing.push(trackId);
    },
  };
}

export function makeSettings(overrides: Partial<AppSettings> = {}) {
  let settings: AppSettings = { ...DEFAULT_SETTINGS, ...overrides };
  return {
    get: () => settings,
    update(patch: Partial<AppSettings>) {
      settings = { ...settings, ...patch };
      return settings;
    },
  };
}

type FakeEntry = { id: number; path: string; options: string };

/**
 * One fake mpv process. It keeps a playlist the way the real one does, since the indexes the Player sends have to be
 * right, and it answers when `deliver` is called, so a test can put things in between. Events are only ever what the
 * test sends.
 */
export class FakeMpv {
  readonly args: string[];
  readonly commands: unknown[][] = [];
  readonly properties = new Map<string, unknown>();
  playlist: FakeEntry[] = [];
  /** -1 when idle. */
  pos = -1;
  killed = false;
  holdingReplies = false;
  /** Answers for get_property. */
  answers = new Map<string, unknown>([
    ['duration', 200],
    ['current-tracks/audio', {}],
  ]);
  /** Commands to refuse, by name. */
  refusing = new Set<string>();

  private nextEntryId = 1;
  private outbox: string[] = [];
  private onDataListener: (chunk: Buffer) => void = () => {};
  private onCloseListener: () => void = () => {};
  private onExitListener: () => void = () => {};
  private isGone = false;

  constructor(args: string[]) {
    this.args = args;
  }

  readonly connection = {
    write: (line: string) => this.receive(line),
    onData: (listener: (chunk: Buffer) => void) => {
      this.onDataListener = listener;
    },
    onClose: (listener: () => void) => {
      this.onCloseListener = listener;
    },
    destroy: () => {},
  };

  onExit(listener: () => void): void {
    this.onExitListener = listener;
  }

  kill(): void {
    this.killed = true;
  }

  /** The connection goes, a moment before the process does. */
  closeConnection(): void {
    this.outbox = [];
    this.onCloseListener();
  }

  /** The process is gone: the connection closes, and then it's reported. */
  exit(): void {
    if (this.isGone) return;
    this.isGone = true;
    this.outbox = [];
    this.onCloseListener();
    this.onExitListener();
  }

  private receive(line: string): void {
    const { command, request_id: id } = JSON.parse(line) as { command: unknown[]; request_id: number };
    this.commands.push(command);
    const reply = this.run(command);
    this.outbox.push(
      JSON.stringify(
        reply.ok
          ? { request_id: id, error: 'success', data: reply.value }
          : { request_id: id, error: reply.error.message },
      ),
    );
  }

  private run(command: unknown[]): Result<unknown> {
    const name = String(command[0]);
    if (this.refusing.has(name)) return err('engine_unavailable', 'error running command');

    switch (name) {
      case 'loadfile': {
        const entry = { id: this.nextEntryId++, path: command[1] as string, options: (command[4] ?? '') as string };
        if (command[2] === 'replace') {
          this.playlist = [entry];
          this.pos = 0;
        } else {
          this.playlist.push(entry);
        }
        return ok({ playlist_entry_id: entry.id });
      }
      case 'playlist-next':
        if (this.pos < 0 || this.pos + 1 >= this.playlist.length)
          return err('engine_unavailable', 'error running command');
        this.pos++;
        return ok(null);
      case 'playlist-remove': {
        const index = Number(command[1]);
        if (this.playlist[index] === undefined) return err('engine_unavailable', 'error running command');
        this.playlist.splice(index, 1);
        if (index < this.pos) this.pos--;
        else if (index === this.pos && this.playlist[this.pos] === undefined) this.pos = -1;
        return ok(null);
      }
      case 'stop':
        this.playlist = [];
        this.pos = -1;
        return ok(null);
      case 'set_property':
        this.properties.set(String(command[1]), command[2]);
        return ok(null);
      case 'get_property':
        return ok(this.answers.get(String(command[1])) ?? null);
      default:
        return ok(null);
    }
  }

  /** Everything said so far gets through, in order. Returns whether anything did. */
  deliver(): boolean {
    if (this.holdingReplies || this.outbox.length === 0) return false;
    const lines = this.outbox;
    this.outbox = [];
    for (const line of lines) this.onDataListener(Buffer.from(`${line}\n`));
    return true;
  }

  /** What's waiting right now, ahead of what the test says next. */
  flushReplies(): void {
    const holding = this.holdingReplies;
    this.holdingReplies = false;
    this.deliver();
    this.holdingReplies = holding;
  }

  /** Ahead of anything still waiting to be answered, which is how a real event overtakes a reply. */
  private say(message: object): void {
    this.onDataListener(Buffer.from(`${JSON.stringify(message)}\n`));
  }

  startFile(id: number): void {
    this.say({ event: 'start-file', playlist_entry_id: id });
  }

  fileLoaded(): void {
    this.say({ event: 'file-loaded' });
  }

  endFile(id: number, reason: string, fileError?: string): void {
    this.say({
      event: 'end-file',
      reason,
      playlist_entry_id: id,
      ...(fileError === undefined ? {} : { file_error: fileError }),
    });
  }

  property(name: string, data: unknown): void {
    this.say({ event: 'property-change', id: 1, name, ...(data === null ? {} : { data }) });
  }

  timePos(seconds: number): void {
    this.property('time-pos', seconds);
  }

  entry(index: number): FakeEntry {
    const entry = this.playlist[index];
    if (entry === undefined) throw new Error(`Nothing at index ${index} of ${JSON.stringify(this.playlist)}`);
    return entry;
  }

  /** The commands of one name, in the order they came. */
  sent(name: string): unknown[][] {
    return this.commands.filter((command) => command[0] === name);
  }

  /** The entry mpv is on starts and finishes loading. */
  startCurrent(): FakeEntry {
    const entry = this.entry(this.pos);
    this.startFile(entry.id);
    this.fileLoaded();
    return entry;
  }

  /**
   * The entry it's on plays to its end and it moves on by itself, as far as that goes: the Player hears the same
   * end-file and start-file whatever it thinks is next.
   */
  finishCurrent(): void {
    const finished = this.entry(this.pos);
    if (this.playlist[this.pos + 1] === undefined) {
      this.endFile(finished.id, 'eof');
      this.pos = -1;
      return;
    }
    this.pos++;
    this.endFile(finished.id, 'eof');
    this.startCurrent();
  }
}

export type PlayerHarness = {
  player: Player;
  /** The newest mpv. */
  mpv: () => FakeMpv;
  spawned: FakeMpv[];
  library: FakeLibrary;
  settings: ReturnType<typeof makeSettings>;
  states: PlayerState[];
  positions: PlayerPosition[];
  notices: Omit<Notice, 'id'>[];
  advance: (ms: number) => void;
  /** Answers go through until nothing more happens. */
  settle: () => Promise<void>;
  /** What the outside was last told, which has to match what the Player says now. */
  lastState: () => PlayerState;
};

export function makeHarness({
  tracks = [1, 2, 3, 4, 5].map((id) => makePlayable(id)),
  settings: settingsOverrides = {},
  pathOf,
  engineExists,
  deps = {},
}: {
  tracks?: PlayableTrack[];
  settings?: Partial<AppSettings>;
  pathOf?: (trackId: number) => string | null;
  engineExists?: (path: string) => boolean;
  deps?: Partial<PlayerDeps>;
} = {}): PlayerHarness {
  const spawned: FakeMpv[] = [];
  const spawn: SpawnMpv = (_path, args) => {
    const mpv = new FakeMpv(args);
    spawned.push(mpv);
    return mpv;
  };

  const library = makeLibrary(tracks, pathOf);
  const settings = makeSettings(settingsOverrides);
  const states: PlayerState[] = [];
  const positions: PlayerPosition[] = [];
  const notices: Omit<Notice, 'id'>[] = [];
  let time = 1_000_000;

  const player = createPlayer({
    settings,
    library,
    emit: (event, payload) => {
      if (event === 'player.state') states.push(payload as PlayerState);
      if (event === 'player.position') positions.push(payload as PlayerPosition);
    },
    notify: (level, message, action) => notices.push({ level, message, action }),
    log: { warn: () => {}, error: () => {} },
    now: () => time,
    enginePath: 'C:\\fake\\mpv.exe',
    engineArgs: ['--ao=null'],
    spawnEngine: spawn,
    engineExists: engineExists ?? (() => true),
    ...deps,
  });

  const mpv = () => {
    const newest = spawned.at(-1);
    if (newest === undefined) throw new Error('Nothing has been spawned');
    return newest;
  };

  return {
    player,
    mpv,
    spawned,
    library,
    settings,
    states,
    positions,
    notices,
    advance: (ms) => {
      time += ms;
    },
    settle: async () => {
      for (let quietPasses = 0; quietPasses < 3;) {
        const hadAny = spawned.length > 0 && mpv().deliver();
        await new Promise((resolve) => setImmediate(resolve));
        quietPasses = hadAny ? 0 : quietPasses + 1;
      }
    },
    lastState: () => {
      const last = states.at(-1);
      if (last === undefined) throw new Error('No state has gone out');
      return last;
    },
  };
}
