/*
 * The Player: the queue and everything about playback live here, and mpv only ever holds the current stretch of audio
 * and the next one. Commands change the state on the spot and then bring mpv into line, one step at a time, so a burst
 * of them only costs the last one. Every entry mpv reports is matched by its id against what it was last told to hold,
 * and anything else it says is about the past.
 */

import * as z from 'zod';
import type {
  AppSettings,
  AudioFormat,
  EnqueuePlace,
  EqSettings,
  Notice,
  OutputMode,
  PlayerPosition,
  PlayerState,
  PlayerStatus,
  QueueItem,
  ReplayGainMode,
} from '@shared/domain';
import { isEqAudible } from '@shared/eqCurve';
import type { EventPayload } from '@shared/ipc/contract';
import type { EventName } from '@shared/ipc/channels';
import { err, ok, type AppError, type Result } from '@shared/result';
import type { Library } from '@main/library/library';
import { clampSeek, indexAtPosition, isPartOfFile, runFrom, type Run } from './cueBoundaries';
import { chainFor, nextEqStep, type EqChain, type EqStep, type HeldEq } from './eqChain';
import { endOption, fileOptions, planWindow, type HeldEntry, type WindowStep } from './gaplessWindow';
import type { MpvClient, MpvEvent } from './mpvClient';
import { createMpvProcess, mpvArgsFromEnv, type EngineProblem, type Logger, type SpawnMpv } from './mpvProcess';
import {
  appendToEnd,
  clearItems,
  currentItem,
  EMPTY_QUEUE,
  enqueue as enqueueItems,
  jumpTo,
  jumpToItem,
  markFileMissing,
  moveItems,
  removeItems,
  replaceQueue,
  stepBack,
  stepForward,
  type Queue,
  type QueuedTrack,
} from './queue';
import { appliedGainDb, signalPath, type ReplayGainTags } from './signalPath';

const POSITION_INTERVAL_MS = 200;
const RESTART_INSTEAD_OF_BACK_MS = 3_000;
// Pressing Next before this counts as not wanting to hear it.
const SKIP_BEFORE_MS = 30_000;
const RADIO_TOP_UP_WHEN_LEFT = 1;
const RADIO_SEEDS = 5;
const RADIO_RECENT = 200;
// Long enough to outlast a pause in a drag, so going through flat on the way across doesn't take the chain out and back.
const EQ_SETTLES_AFTER_MS = 300;

const FILE_GONE = 'loading failed';
const DEVICE_FAILED = 'audio output initialization failed';

const OBSERVED = ['time-pos', 'idle-active', 'audio-params', 'audio-out-params'];

const MPV_REPLAY_GAIN: Record<ReplayGainMode, string> = { off: 'no', track: 'track', album: 'album' };

const NOTHING_PLAYED = 'None of the tracks in the queue could be played';
// It can't say which: another app holding the device and an output that refuses exclusive, as Bluetooth does, look the same here.
const EXCLUSIVE_UNAVAILABLE = "This output can't do exclusive mode right now, so playback went back to shared mode";
const DEVICE_FAILED_WORDS = "The audio device couldn't be opened. Close whatever is using it, then try again.";
const ENGINE_KEEPS_CRASHING = 'The audio engine keeps stopping. Press Retry, and restart the app if it happens again.';

const engineMissingWords = (path: string) => `The audio engine isn't at ${path}. Reinstall the app to bring it back.`;
const RADIO_RAN_OUT = 'Radio has nothing else to play';
const skippedMissing = (title: string) => `"${title}" isn't where it was, so it was skipped`;
const skippedBroken = (title: string) => `"${title}" couldn't be played, so it was skipped`;
const skippedUnknown = (title: string) => `"${title}" isn't in the library any more, so it was skipped`;

const loadReplySchema = z.object({ playlist_entry_id: z.int() });
const audioParamsSchema = z.object({ samplerate: z.number(), 'channel-count': z.number(), format: z.string() });
const durationSchema = z.number().positive();
const positionSchema = z.number();
const gainField = z.number().nullish().catch(null);
const audioTrackSchema = z.object({
  'replaygain-track-gain': gainField,
  'replaygain-track-peak': gainField,
  'replaygain-album-gain': gainField,
  'replaygain-album-peak': gainField,
});

function toAudioFormat(data: unknown): AudioFormat | null {
  const parsed = audioParamsSchema.safeParse(data);
  if (!parsed.success) return null;
  return { sampleRate: parsed.data.samplerate, format: parsed.data.format, channels: parsed.data['channel-count'] };
}

function toGainTags(data: unknown): ReplayGainTags | null {
  const parsed = audioTrackSchema.safeParse(data);
  if (!parsed.success) return null;
  return {
    trackGainDb: parsed.data['replaygain-track-gain'] ?? null,
    trackPeak: parsed.data['replaygain-track-peak'] ?? null,
    albumGainDb: parsed.data['replaygain-album-gain'] ?? null,
    albumPeak: parsed.data['replaygain-album-peak'] ?? null,
  };
}

export type PlayerDeps = {
  settings: {
    get(): AppSettings;
    update(patch: Partial<AppSettings>): unknown;
  };
  library: Pick<Library, 'status' | 'onStatus' | 'playableTracks' | 'absolutePath' | 'markMissing'>;
  emit: <E extends EventName>(event: E, payload: EventPayload<E>) => void;
  notify: (level: Notice['level'], message: string, action: Notice['action']) => void;
  log: Logger;
  now: () => number;
  /** Where system/binaries says the engine should be. */
  enginePath: string;
  /** Appended after the app's own. Defaults to what MUSIC_PLAYER_MPV_ARGS says. */
  engineArgs?: string[];
  spawnEngine?: SpawnMpv;
  engineExists?: (path: string) => boolean;
  /** Told where playback is as it goes, for whoever keeps count of what's been heard. */
  listening?: {
    position: (report: ListeningReport) => void;
    stopped: () => void;
    skipped?: (trackId: number) => void;
  };
  /** Suggests what to add when the queue runs out, from what's owned. It knows nothing about playing. */
  suggest?: (seeds: number[], recent: number[]) => Promise<number[]>;
};

/** `listen` is the same from when an item becomes current until something else does, seeks and pauses included. */
export type ListeningReport = {
  listen: number;
  trackId: number;
  durationMs: number;
  positionMs: number;
};

/**
 * - `idle`: nothing is current.
 * - `active`: mpv should be on the current item.
 * - `ended`: the queue ran out, and the last track stays on show.
 * - `error`: it stopped on a failure, and the position stays for a retry.
 */
type Mode = 'idle' | 'active' | 'ended' | 'error';

/** One running mpv and what it was last told. Commands update this as they're sent, not when they're answered. */
type Engine = {
  client: MpvClient;
  entries: HeldEntry[];
  playingId: number | null;
  atQueueId: number | null;
  isLoaded: boolean;
  /** One entry ended and mpv is moving on to the next by itself: the item it ended on, and the one it's going to. */
  movingOn: { from: number | null; to: number } | null;
  /** On an entry mpv moved to by itself, whose file-loaded hasn't come yet. Gapless, so it isn't a load to anyone. */
  movedBySelf: boolean;
  /** The last start-file, wanted or not. file-loaded has no id, and this is how to tell whose it is. */
  lastStartedId: number | null;
  isPumping: boolean;
  isLoadInFlight: boolean;
  /** Events from a start-file that came ahead of the reply that would explain it, kept in order until it does. */
  heldBack: MpvEvent[] | null;
  wantedSeekMs: number | null;
  seeking: Promise<void> | null;
  eq: HeldEq;
};

export type Player = ReturnType<typeof createPlayer>;

export function createPlayer(deps: PlayerDeps) {
  const { settings, library, emit, notify, log, now } = deps;

  let queue = EMPTY_QUEUE;
  let queueVersion = 0;
  let mode: Mode = 'idle';
  let loadId = 0;
  let isPaused = false;
  let positionMs = 0;
  let resumeAtMs: number | null = null;
  let pendingSeekMs: number | null = null;
  let failure: AppError | null = null;
  let engineFailure: AppError | null = null;
  let engine: Engine | null = null;
  let eqSettling: ReturnType<typeof setTimeout> | null = null;

  let decoded: AudioFormat | null = null;
  let output: AudioFormat | null = null;
  let gainTags: ReplayGainTags | null = null;
  let fileDurationMs: number | null = null;
  let listen = 0;

  let isAskingRadio = false;
  let radioGeneration = 0;
  let radioRanOutAt: number | null = null;

  // For stopping after the whole queue has been tried, without going round forever on a queue that does play.
  let failedInARow = 0;
  let hasPlayed = false;
  const unplayable = new Set<number>();

  const initialStatus = library.status();
  let libraryFolder = initialStatus.state === 'ready' ? initialStatus.folder : null;

  let emittedState = '';
  const stateListeners: ((next: PlayerState) => void)[] = [];
  let emittedPosition: PlayerPosition | null = null;
  let nextPositionAt = 0;

  const supervisor = createMpvProcess({
    path: deps.enginePath,
    extraArgs: deps.engineArgs ?? mpvArgsFromEnv(),
    ...(deps.spawnEngine ? { spawn: deps.spawnEngine } : {}),
    ...(deps.engineExists ? { exists: deps.engineExists } : {}),
    now,
    log,
    onEvent,
    onReady,
    onLost,
    onUnavailable,
  });

  // What the outside sees.

  function status(): PlayerStatus {
    if (engineFailure !== null) return 'unavailable';
    if (mode === 'error') return 'error';
    if (mode === 'ended') return 'ended';
    const current = currentItem(queue);
    if (mode === 'idle' || current === null) return 'idle';
    if (engine === null) return 'loading';

    const isSeamless = engine.movingOn !== null || engine.movedBySelf;
    const hasArrived = engine.atQueueId === current.queueId && engine.isLoaded;
    if (!isSeamless && !hasArrived) return 'loading';
    return isPaused ? 'paused' : 'playing';
  }

  function durationOf(item: QueuedTrack | null): number {
    if (item === null) return 0;
    const isWholeFile = !isPartOfFile(item.range);
    const isOpen = engine?.atQueueId === item.queueId;
    return isWholeFile && isOpen && fileDurationMs !== null ? fileDurationMs : item.track.durationMs;
  }

  function state(): PlayerState {
    const current = currentItem(queue);
    const { volume, muted, outputMode, replayGainMode, eq } = settings.get();
    return {
      loadId,
      status: status(),
      current: current?.track ?? null,
      queueIndex: queue.index,
      queueLength: queue.items.length,
      queueVersion,
      durationMs: durationOf(current),
      volume,
      muted,
      outputMode,
      replayGainMode,
      eq,
      radio: settings.get().radio,
      signal: signalPath({
        decoded,
        output,
        outputMode,
        eqAudible: isEqAudible(eq),
        replayGainDb: appliedGainDb(replayGainMode, gainTags),
        volume,
        muted,
      }),
      error: engineFailure ?? failure,
    };
  }

  function emitState(): void {
    const next = state();
    const serialized = JSON.stringify(next);
    if (serialized === emittedState) return;
    emittedState = serialized;
    emit('player.state', next);
    for (const listener of stateListeners) listener(next);
  }

  function relayPosition({ force = false } = {}): void {
    const time = now();
    if (!force && time < nextPositionAt) return;
    // From when the last one was due, not when it went, so the rate holds even though mpv's ticks don't line up with it.
    nextPositionAt =
      nextPositionAt + POSITION_INTERVAL_MS > time
        ? nextPositionAt + POSITION_INTERVAL_MS
        : time + POSITION_INTERVAL_MS;

    const payload: PlayerPosition = { loadId, positionMs: Math.round(positionMs) };
    if (payload.loadId === emittedPosition?.loadId && payload.positionMs === emittedPosition.positionMs) return;
    emittedPosition = payload;
    emit('player.position', payload);
  }

  // Bringing mpv into line.

  function wantedIndex(): number | null {
    return mode === 'active' ? queue.index : null;
  }

  function plan(mine: Engine): WindowStep[] {
    return planWindow(
      queue.items,
      wantedIndex(),
      { ...mine, isMovingOn: mine.movingOn !== null },
      (item) => !unplayable.has(item.queueId),
    );
  }

  /** Still the mpv in use and still connected. A connection can close before the exit that says so gets here. */
  function isLive(mine: Engine): boolean {
    return engine === mine && mine.client.isOpen();
  }

  /** Commands go one at a time, so each step is worked out from everything that happened before it. */
  async function drain(mine: Engine): Promise<void> {
    try {
      while (isLive(mine)) {
        // Ahead of what to load, so a new mpv has its chain before it opens anything.
        const eqStep = nextEqStep(mine.eq, wantedEq(mine), eqSettling !== null);
        if (eqStep !== null) {
          await performEq(mine, eqStep);
          continue;
        }
        const step = plan(mine)[0];
        if (step === undefined) return;
        await perform(mine, step);
        emitState();
      }
    } finally {
      mine.isPumping = false;
    }
  }

  function pump(): void {
    const mine = engine;
    if (mine === null || mine.isPumping) return;
    mine.isPumping = true;
    drain(mine).catch((error: unknown) => log.error('Keeping mpv in line failed', error));
  }

  function sync(): void {
    pump();
    emitState();
    topUpFromRadio();
  }

  /** When the queue is about to run out. The answer goes at the end of it, so mpv's next entry follows by the usual path. */
  function topUpFromRadio(): void {
    const { suggest } = deps;
    const index = queue.index;
    if (suggest === undefined || !settings.get().radio || isAskingRadio || index === null) return;
    if (mode !== 'active' || queue.items.length - index - 1 > RADIO_TOP_UP_WHEN_LEFT) return;
    if (radioRanOutAt === queueVersion) return;

    const generation = radioGeneration;
    const played = queue.items.slice(0, index + 1).map(({ track }) => track.id);
    const recent = queue.items.slice(-RADIO_RECENT).map(({ track }) => track.id);
    isAskingRadio = true;
    suggest(played.slice(-RADIO_SEEDS), recent)
      .then((trackIds) => addFromRadio(trackIds, generation))
      .catch((error: unknown) => {
        log.warn('Radio could not suggest anything', error);
        addFromRadio([], generation);
      });
  }

  function addFromRadio(trackIds: number[], generation: number): void {
    isAskingRadio = false;
    // The queue it was asked about has been replaced, so the ask starts over for the one that's there now.
    if (generation !== radioGeneration) {
      topUpFromRadio();
      return;
    }
    if (!settings.get().radio) return;

    const tracks = library.playableTracks(trackIds);
    const owned = tracks.ok ? tracks.value.filter(({ track }) => !track.isMissing) : [];
    if (owned.length === 0) {
      radioRanOutAt = queueVersion;
      notify('info', RADIO_RAN_OUT, null);
      return;
    }

    const hadEnded = mode === 'ended';
    const firstNew = queue.items.length;
    setQueue(appendToEnd(queue, owned));
    const moved = hadEnded ? jumpTo(queue, firstNew) : null;
    if (moved === null) {
      sync();
      return;
    }
    arrive(moved);
    begin();
  }

  async function send(mine: Engine, args: (string | number | boolean)[]): Promise<Result<unknown>> {
    const reply = await mine.client.command(args);
    if (!reply.ok && isLive(mine)) log.warn(`mpv refused ${String(args[0])}`, reply.error.message);
    return reply;
  }

  function setProperty(name: string, value: string | number | boolean): void {
    if (engine !== null) void send(engine, ['set_property', name, value]);
  }

  function forgetFile(): void {
    gainTags = null;
    fileDurationMs = null;
  }

  function perform(mine: Engine, step: WindowStep): Promise<void> {
    switch (step.kind) {
      case 'stop':
        return performStop(mine);
      case 'load':
        return performLoad(mine, step.mode, step.run);
      case 'next':
        return performNext(mine);
      case 'remove':
        return performRemove(mine, step.index);
      case 'set-end':
        return performSetEnd(mine, step.endMs);
      case 'seek':
        mine.atQueueId = step.queueId;
        return seekEngine(mine, step.fileMs);
    }
  }

  async function performStop(mine: Engine): Promise<void> {
    mine.entries = [];
    mine.playingId = null;
    mine.atQueueId = null;
    mine.isLoaded = false;
    mine.movingOn = null;
    mine.movedBySelf = false;
    decoded = null;
    output = null;
    forgetFile();
    await send(mine, ['stop']);
  }

  async function performLoad(mine: Engine, loadMode: 'replace' | 'append', run: Run): Promise<void> {
    const queueId = run.firstQueueId;
    const path = library.absolutePath(run.trackId);
    if (path === null) {
      unplayable.add(queueId);
      if (loadMode === 'replace') giveUpOn(mine, queueId, skippedUnknown);
      return;
    }

    const resumeFrom = loadMode === 'replace' && resumeAtMs !== null ? resumeAtMs : 0;
    const startMs = run.startMs + clampSeek(resumeFrom, durationOf(currentItem(queue)));
    if (loadMode === 'replace') {
      resumeAtMs = null;
      mine.entries = [];
      mine.playingId = null;
      mine.atQueueId = queueId;
      mine.isLoaded = false;
      mine.movingOn = null;
      mine.movedBySelf = false;
      forgetFile();
    }

    const options = fileOptions({ startMs, endMs: run.endMs });
    mine.isLoadInFlight = true;
    const reply = await send(mine, ['loadfile', path, loadMode, ...(options === '' ? [] : [-1, options])]);
    mine.isLoadInFlight = false;
    if (!isLive(mine)) return;

    const loaded = loadReplySchema.safeParse(reply.ok ? reply.value : null);
    if (!loaded.success) {
      unplayable.add(queueId);
      if (loadMode === 'replace') giveUpOn(mine, queueId, skippedBroken);
      releaseHeldBack(mine);
      return;
    }

    const entryId = loaded.data.playlist_entry_id;
    mine.entries.push({ entryId, queueId, fileId: run.fileId, endMs: run.endMs });
    if (loadMode === 'replace') mine.playingId = entryId;
    releaseHeldBack(mine);
  }

  async function performNext(mine: Engine): Promise<void> {
    const following = mine.entries[mine.entries.findIndex(({ entryId }) => entryId === mine.playingId) + 1];
    if (following === undefined) return;

    mine.playingId = following.entryId;
    mine.atQueueId = following.queueId;
    mine.isLoaded = false;
    mine.movedBySelf = false;
    forgetFile();

    // A refusal means mpv isn't where it was thought to be: it got there by itself just now, or it has gone idle. If it
    // hasn't said it's there, a load puts it right, and a track that has only just started loses nothing by doing so.
    const reply = await mine.client.command(['playlist-next']);
    if (!isLive(mine) || reply.ok || mine.playingId !== following.entryId) return;
    if (mine.lastStartedId !== following.entryId) {
      mine.playingId = null;
      mine.atQueueId = null;
    }
  }

  async function performRemove(mine: Engine, index: number): Promise<void> {
    mine.entries.splice(index, 1);
    const reply = await send(mine, ['playlist-remove', index]);
    if (!reply.ok && isLive(mine)) reloadFromHere(mine);
  }

  async function performSetEnd(mine: Engine, endMs: number | null): Promise<void> {
    const playing = mine.entries.find(({ entryId }) => entryId === mine.playingId);
    if (playing !== undefined) playing.endMs = endMs;
    await send(mine, ['set_property', 'file-local-options/end', endOption(endMs)]);
  }

  /** The next load starts from here. What mpv holds no longer counts. */
  function reloadFromHere(mine: Engine): void {
    resumeAtMs = positionMs;
    loadId++;
    mine.playingId = null;
    mine.atQueueId = null;
    mine.isLoaded = false;
    mine.movingOn = null;
    mine.movedBySelf = false;
  }

  /** Only one at a time goes out, so dragging across the seekbar only costs where it ended up. */
  function seekEngine(mine: Engine, fileMs: number): Promise<void> {
    mine.wantedSeekMs = fileMs;
    mine.seeking ??= (async () => {
      while (mine.wantedSeekMs !== null) {
        const target = mine.wantedSeekMs;
        mine.wantedSeekMs = null;
        await send(mine, ['seek', target / 1000, 'absolute']);
      }
      mine.seeking = null;
    })();
    return mine.seeking;
  }

  // The EQ. Each step is worked out from the settings as they are by then, so a drag only costs where it has got to.

  function wantedEq(mine: Engine): EqChain | null {
    const { eq } = settings.get();
    if (isEqAudible(eq)) return chainFor(eq);
    const isPassingThroughFlat = eqSettling !== null && eq.enabled && eq.bands.length > 0 && mine.eq.spec !== null;
    return isPassingThroughFlat ? chainFor(eq) : null;
  }

  async function performEq(mine: Engine, step: EqStep): Promise<void> {
    switch (step.kind) {
      case 'clear':
        mine.eq = { spec: null, live: null };
        await send(mine, ['af', 'clr', '']);
        return;
      case 'set':
        mine.eq = { spec: step.spec, live: step.chain };
        await send(mine, ['af', 'set', step.spec]);
        return;
      case 'command': {
        mine.eq.live = step.live;
        // Refused until a file has started the filters, and refused again in the moment a load takes them down.
        const reply = await mine.client.command(['af-command', ...step.args]);
        if (!reply.ok) mine.eq.live = null;
      }
    }
  }

  // Moving through the queue.

  function setQueue(next: Queue): void {
    if (next.items !== queue.items) queueVersion++;
    queue = next;
  }

  function endListen(): void {
    listen++;
    deps.listening?.stopped();
  }

  /** A different item is current, or the same one is starting over. */
  function arrive(next: Queue): void {
    endListen();
    setQueue(next);
    positionMs = 0;
    resumeAtMs = null;
    pendingSeekMs = null;
    loadId++;
    nextPositionAt = 0;
  }

  function setPaused(value: boolean): void {
    if (isPaused === value) return;
    isPaused = value;
    setProperty('pause', value);
  }

  /** Someone asked for this, so whatever had gone wrong before starts counting again. */
  function begin(): void {
    mode = 'active';
    failure = null;
    failedInARow = 0;
    hasPlayed = false;
    sync();
  }

  function endOfQueue(): void {
    endListen();
    mode = 'ended';
    sync();
  }

  function stopOnFailures(): void {
    mode = 'error';
    failure = { code: 'file_missing', message: NOTHING_PLAYED };
    resumeAtMs = null;
    sync();
  }

  function noteHeard(): void {
    failedInARow = 0;
    hasPlayed = true;
  }

  /**
   * What happens when an entry is over, one way or another. The queue goes past everything the entry played, unless a
   * command has already moved it. When mpv is about to go to that item by itself it's left to, because that's gapless.
   */
  function moveOn(
    mine: Engine,
    finished: number | null,
    following: HeldEntry | null,
    { wrap }: { wrap: boolean },
  ): void {
    const current = currentItem(queue);
    const index = queue.index;
    if (mode !== 'active' || current === null || index === null) {
      sync();
      return;
    }

    if (current.queueId !== finished) {
      if (following?.queueId === current.queueId) mine.movingOn = { from: finished, to: current.queueId };
      sync();
      return;
    }

    const played = runFrom(queue.items, index)?.queueIds.length ?? 1;
    const target = jumpTo(queue, index + played) ?? (wrap && !hasPlayed ? jumpTo(queue, 0) : null);
    if (target === null) {
      endOfQueue();
      return;
    }

    const targetId = currentItem(target)?.queueId;
    if (targetId !== undefined && following?.queueId === targetId) mine.movingOn = { from: finished, to: targetId };
    else arrive(target);
    sync();
  }

  function giveUpOn(mine: Engine, queueId: number, words: (title: string) => string): void {
    const item = queue.items.find((candidate) => candidate.queueId === queueId);
    if (item !== undefined) notify('warning', words(item.track.title), null);
    failedInARow += runLengthAt(queueId);
    if (failedInARow >= queue.items.length) stopOnFailures();
    else moveOn(mine, queueId, null, { wrap: true });
  }

  function runLengthAt(queueId: number): number {
    const index = queue.items.findIndex((item) => item.queueId === queueId);
    return index < 0 ? 1 : (runFrom(queue.items, index)?.queueIds.length ?? 1);
  }

  // What mpv says.

  function isHeld(mine: Engine, entryId: number): boolean {
    return mine.entries.some((entry) => entry.entryId === entryId);
  }

  function onEvent(event: MpvEvent): void {
    const mine = engine;
    if (mine === null) return;
    if (mine.heldBack !== null) {
      mine.heldBack.push(event);
      return;
    }
    if (event.type === 'start-file' && mine.isLoadInFlight && !isHeld(mine, event.entryId)) {
      mine.heldBack = [event];
      return;
    }
    handle(mine, event);
  }

  function releaseHeldBack(mine: Engine): void {
    const events = mine.heldBack;
    mine.heldBack = null;
    for (const event of events ?? []) handle(mine, event);
  }

  function handle(mine: Engine, event: MpvEvent): void {
    switch (event.type) {
      case 'start-file':
        onStartFile(mine, event.entryId);
        return;
      case 'file-loaded':
        onFileLoaded(mine);
        return;
      case 'end-file':
        onEndFile(mine, event);
        return;
      case 'property-change':
        onProperty(mine, event.name, event.data);
    }
  }

  function onStartFile(mine: Engine, entryId: number): void {
    mine.lastStartedId = entryId;
    const entry = mine.entries.find((candidate) => candidate.entryId === entryId);
    if (entry === undefined) return;

    mine.isLoaded = false;
    forgetFile();
    if (mine.playingId === entryId) return;

    // mpv moved here by itself.
    const from = mine.movingOn?.from ?? null;
    mine.movingOn = null;
    mine.movedBySelf = true;
    mine.playingId = entryId;
    mine.atQueueId = entry.queueId;
    if (from !== null) followTo(from, entry.queueId);
    sync();
  }

  /** The queue follows, unless a command has taken it somewhere else in the meantime. */
  function followTo(from: number, to: number): void {
    if (currentItem(queue)?.queueId !== from) return;
    const moved = jumpToItem(queue, to);
    if (moved !== null) arrive(moved);
  }

  function onFileLoaded(mine: Engine): void {
    if (mine.playingId === null || mine.lastStartedId !== mine.playingId) return;
    mine.isLoaded = true;
    mine.movedBySelf = false;
    readFileFacts(mine, mine.playingId);

    const current = currentItem(queue);
    if (pendingSeekMs !== null && current !== null && mine.atQueueId === current.queueId) {
      void seekEngine(mine, current.range.startMs + pendingSeekMs);
      pendingSeekMs = null;
    }
    sync();
  }

  /** What only the open file can say. The answers only count if that file is still the one open. */
  function readFileFacts(mine: Engine, entryId: number): void {
    void Promise.all([
      mine.client.command(['get_property', 'duration']),
      mine.client.command(['get_property', 'current-tracks/audio']),
    ]).then(([duration, track]) => {
      if (engine !== mine || mine.lastStartedId !== entryId) return;
      const seconds = durationSchema.safeParse(duration.ok ? duration.value : null);
      fileDurationMs = seconds.success ? Math.round(seconds.data * 1000) : null;
      gainTags = track.ok ? toGainTags(track.value) : null;
      emitState();
    });
  }

  function onEndFile(mine: Engine, { entryId, reason, fileError }: Extract<MpvEvent, { type: 'end-file' }>): void {
    if (entryId !== mine.playingId) return;

    switch (reason) {
      case 'eof':
        noteHeard();
        finishEntry(mine, entryId, { wrap: false });
        return;
      case 'error':
        if (fileError === DEVICE_FAILED) onDeviceFailed(mine);
        else onFileFailed(mine, entryId, fileError);
        return;
      case 'quit':
        return;
      case 'stop':
      case 'redirect':
      case 'unknown':
        // Nothing here asked for that, so it goes back to where it was.
        reloadFromHere(mine);
        sync();
    }
  }

  function finishEntry(mine: Engine, entryId: number, { wrap }: { wrap: boolean }): void {
    const finished = mine.atQueueId;
    const following = mine.entries[mine.entries.findIndex((entry) => entry.entryId === entryId) + 1] ?? null;
    mine.playingId = null;
    mine.atQueueId = null;
    mine.isLoaded = false;
    mine.movedBySelf = false;
    moveOn(mine, finished, following, { wrap });
  }

  function onFileFailed(mine: Engine, entryId: number, fileError: string | null): void {
    const item = queue.items.find(({ queueId }) => queueId === mine.atQueueId);
    if (item !== undefined) {
      const isGone = fileError === FILE_GONE;
      if (isGone) {
        library.markMissing(item.track.id);
        setQueue(markFileMissing(queue, item.range.fileId));
      }
      const words = isGone ? skippedMissing : skippedBroken;
      notify('warning', words(item.track.title), { kind: 'reveal-track', label: 'Reveal', trackId: item.track.id });
      failedInARow += runLengthAt(item.queueId);
    }

    if (failedInARow >= queue.items.length) {
      mine.playingId = null;
      mine.atQueueId = null;
      stopOnFailures();
    } else {
      finishEntry(mine, entryId, { wrap: true });
    }
  }

  /** The device is the problem, not the track, so the track never gets skipped for it. */
  function onDeviceFailed(mine: Engine): void {
    reloadFromHere(mine);

    if (settings.get().outputMode === 'exclusive') {
      settings.update({ outputMode: 'shared' });
      setProperty('audio-exclusive', false);
      notify('warning', EXCLUSIVE_UNAVAILABLE, null);
      sync();
      return;
    }

    mode = 'error';
    // The transport says this for as long as it lasts, with its own Retry, so it isn't a toast as well.
    failure = { code: 'device_busy', message: DEVICE_FAILED_WORDS };
    sync();
  }

  function onProperty(mine: Engine, name: string, data: unknown): void {
    switch (name) {
      case 'time-pos':
        onTimePos(mine, data);
        return;
      case 'idle-active':
        if (data === true) onIdle(mine);
        return;
      // Empty for a moment at every change of file, and the next one's comes straight after.
      case 'audio-params':
        decoded = toAudioFormat(data) ?? decoded;
        emitState();
        return;
      case 'audio-out-params':
        output = toAudioFormat(data) ?? output;
        emitState();
    }
  }

  function onIdle(mine: Engine): void {
    decoded = null;
    output = null;

    // The next entry went in just too late for mpv to move on to it, so it has to be told.
    if (mine.movingOn !== null && mine.movingOn.from !== null) followTo(mine.movingOn.from, mine.movingOn.to);
    mine.movingOn = null;
    sync();
  }

  function onTimePos(mine: Engine, data: unknown): void {
    const seconds = positionSchema.safeParse(data);
    // While paused the position only moves by seeking, and mpv's own idea of it after a seek is a little off.
    if (!seconds.success || isPaused || !mine.isLoaded || mine.seeking !== null) return;

    const index = queue.index;
    const current = currentItem(queue);
    if (index === null || current === null || mine.atQueueId !== current.queueId) return;

    const fileMs = seconds.data * 1000;
    const atIndex = indexAtPosition(queue.items, index, fileMs);
    if (atIndex !== index) {
      const moved = jumpTo(queue, atIndex);
      if (moved !== null) {
        arrive(moved);
        mine.atQueueId = currentItem(moved)?.queueId ?? null;
        sync();
      }
    }

    const playing = currentItem(queue);
    positionMs = Math.max(0, fileMs - (playing?.range.startMs ?? 0));
    if (positionMs > 0) noteHeard();
    if (playing !== null) {
      deps.listening?.position({ listen, trackId: playing.track.id, durationMs: durationOf(playing), positionMs });
    }
    relayPosition();
  }

  // A new mpv, a lost one, and no more of them.

  function onReady(client: MpvClient): void {
    const mine: Engine = {
      client,
      entries: [],
      playingId: null,
      atQueueId: null,
      isLoaded: false,
      movingOn: null,
      movedBySelf: false,
      lastStartedId: null,
      isPumping: false,
      isLoadInFlight: false,
      heldBack: null,
      wantedSeekMs: null,
      seeking: null,
      eq: { spec: null, live: null },
    };
    engine = mine;
    engineFailure = null;

    const { volume, muted, outputMode, replayGainMode } = settings.get();
    OBSERVED.forEach((name, index) => void send(mine, ['observe_property', index + 1, name]));
    setProperty('volume', volume);
    setProperty('mute', muted);
    setProperty('audio-exclusive', outputMode === 'exclusive');
    setProperty('replaygain', MPV_REPLAY_GAIN[replayGainMode]);
    setProperty('pause', isPaused);

    if (mode === 'active' && currentItem(queue) !== null) {
      resumeAtMs = positionMs;
      pendingSeekMs = null;
      loadId++;
    }
    sync();
  }

  function onLost(): void {
    engine = null;
    decoded = null;
    output = null;
    forgetFile();
    emitState();
  }

  function onUnavailable(problem: EngineProblem): void {
    const words: Record<EngineProblem, string> = {
      missing: engineMissingWords(deps.enginePath),
      crashing: ENGINE_KEEPS_CRASHING,
    };
    engineFailure = { code: 'engine_unavailable', message: words[problem] };
    emitState();
  }

  function refusedForEngine(): Result<void> | null {
    return engineFailure === null ? null : { ok: false, error: engineFailure };
  }

  // Dropping everything, for when the ids in the queue stop meaning anything.

  function dropQueue(): void {
    radioGeneration++;
    endListen();
    setQueue(clearItems(queue));
    mode = 'idle';
    failure = null;
    positionMs = 0;
    resumeAtMs = null;
    pendingSeekMs = null;
    unplayable.clear();
    setPaused(false);
    sync();
  }

  const stopListening = library.onStatus((next) => {
    const isSameLibrary = next.state === 'ready' && (libraryFolder === null || next.folder === libraryFolder);
    libraryFolder = next.state === 'ready' ? next.folder : null;
    if (!isSameLibrary) dropQueue();
  });

  emittedState = JSON.stringify(state());

  // Commands.

  function play(trackIds: number[], startIndex: number): Result<void> {
    const refused = refusedForEngine();
    if (refused !== null) return refused;

    const tracks = library.playableTracks(trackIds);
    if (!tracks.ok) return tracks;
    if (tracks.value.length === 0) return err('not_found', "Those tracks aren't in the library");

    // One that's gone from the library takes its place in the list with it, so the start follows the track.
    const wanted = trackIds[startIndex];
    const start =
      tracks.value.length === trackIds.length
        ? startIndex
        : Math.max(
            0,
            tracks.value.findIndex(({ track }) => track.id === wanted),
          );

    setPaused(false);
    radioGeneration++;
    arrive(replaceQueue(queue, tracks.value, start));
    unplayable.clear();
    begin();
    return ok();
  }

  function seek(target: number): Result<void> {
    const refused = refusedForEngine();
    if (refused !== null) return refused;

    const current = currentItem(queue);
    if (current === null) return ok();

    positionMs = clampSeek(target, durationOf(current));
    relayPosition({ force: true });

    if (mode === 'ended') {
      // There's nothing open to seek in, so it opens again from there.
      resumeAtMs = positionMs;
      loadId++;
      begin();
    } else if (mode === 'error') {
      resumeAtMs = positionMs;
    } else if (engine?.atQueueId === current.queueId && engine.isLoaded) {
      void seekEngine(engine, current.range.startMs + positionMs);
    } else {
      pendingSeekMs = positionMs;
    }
    return ok();
  }

  function playQueueIndex(index: number): Result<void> {
    const refused = refusedForEngine();
    if (refused !== null) return refused;

    const target = jumpTo(queue, index);
    if (target === null) return err('not_found', "There's nothing at that place in the queue");

    setPaused(false);
    if (mode === 'active' && index === queue.index) return seek(0);
    arrive(target);
    begin();
    return ok();
  }

  function next(): Result<void> {
    const refused = refusedForEngine();
    if (refused !== null) return refused;

    const skipped = currentItem(queue);
    if (skipped !== null && mode === 'active' && positionMs < SKIP_BEFORE_MS)
      deps.listening?.skipped?.(skipped.track.id);

    const stepped = stepForward(queue);
    if (stepped !== null) {
      arrive(stepped);
      begin();
    } else if (mode === 'active') {
      endOfQueue();
    }
    return ok();
  }

  function previous(): Result<void> {
    const refused = refusedForEngine();
    if (refused !== null) return refused;

    if (currentItem(queue) === null) return ok();
    const stepped = positionMs > RESTART_INSTEAD_OF_BACK_MS ? null : stepBack(queue);
    if (stepped === null) return seek(0);

    arrive(stepped);
    begin();
    return ok();
  }

  function pause(): Result<void> {
    if (mode !== 'active') return ok();
    setPaused(true);
    relayPosition({ force: true });
    emitState();
    return ok();
  }

  function retry(): Result<void> {
    if (engineFailure !== null) {
      supervisor.retry();
      return refusedForEngine() ?? ok();
    }
    if (mode === 'error') {
      loadId++;
      begin();
    }
    return ok();
  }

  function resume(): Result<void> {
    const refused = refusedForEngine();
    if (refused !== null) return refused;

    if (mode === 'error') return retry();
    if (mode === 'active') {
      setPaused(false);
      nextPositionAt = 0;
      emitState();
      return ok();
    }

    // Ended, or nothing was current: the queue starts again from the top.
    const fromTop = jumpTo(queue, 0);
    if (fromTop === null) return ok();
    setPaused(false);
    arrive(fromTop);
    begin();
    return ok();
  }

  function toggle(): Result<void> {
    const current = status();
    return current === 'playing' || (current === 'loading' && !isPaused) ? pause() : resume();
  }

  function enqueue(trackIds: number[], where: EnqueuePlace): Result<void> {
    const tracks = library.playableTracks(trackIds);
    if (!tracks.ok) return tracks;
    setQueue(enqueueItems(queue, tracks.value, where));
    sync();
    return ok();
  }

  function removeFromQueue(queueIds: number[]): Result<void> {
    const before = currentItem(queue)?.queueId ?? null;
    const remaining = removeItems(queue, queueIds);
    const after = currentItem(remaining)?.queueId ?? null;

    if (after === before) {
      setQueue(remaining);
    } else {
      arrive(remaining);
      if (after === null) {
        mode = 'idle';
        failure = null;
      }
    }
    sync();
    return ok();
  }

  return {
    state,
    /** For what lives in main and shows the state itself, such as the taskbar's buttons. */
    onState(listener: (next: PlayerState) => void): void {
      stateListeners.push(listener);
    },
    position: (): PlayerPosition => ({ loadId, positionMs: Math.round(positionMs) }),
    queue: (): QueueItem[] => queue.items.map(({ queueId, track }) => ({ queueId, track })),
    nextTrackId(): number | null {
      const after = stepForward(queue);
      return after === null ? null : (currentItem(after)?.track.id ?? null);
    },

    play,
    playQueueIndex,
    toggle,
    pause,
    resume,
    next,
    previous,
    seek,

    setVolume(volume: number): Result<void> {
      settings.update({ volume });
      setProperty('volume', volume);
      emitState();
      return ok();
    },

    setMuted(muted: boolean): Result<void> {
      settings.update({ muted });
      setProperty('mute', muted);
      emitState();
      return ok();
    },

    setOutputMode(outputMode: OutputMode): Result<void> {
      if (settings.get().outputMode === outputMode) return ok();
      settings.update({ outputMode });
      // On its own this reopens the output, and a device that's busy comes back as a failed output like any other.
      setProperty('audio-exclusive', outputMode === 'exclusive');
      emitState();
      return ok();
    },

    setReplayGainMode(replayGainMode: ReplayGainMode): Result<void> {
      settings.update({ replayGainMode });
      setProperty('replaygain', MPV_REPLAY_GAIN[replayGainMode]);
      emitState();
      return ok();
    },

    setRadio(radio: boolean): Result<void> {
      settings.update({ radio });
      if (radio) radioRanOutAt = null;
      sync();
      return ok();
    },

    setEq(eq: EqSettings): Result<void> {
      settings.update({ eq });
      if (eqSettling !== null) clearTimeout(eqSettling);
      eqSettling = setTimeout(() => {
        eqSettling = null;
        sync();
      }, EQ_SETTLES_AFTER_MS);
      sync();
      return ok();
    },

    enqueue,
    removeFromQueue,

    moveInQueue(queueIds: readonly number[], toIndex: number): Result<void> {
      setQueue(moveItems(queue, queueIds, toIndex));
      sync();
      return ok();
    },

    clearQueue(): Result<void> {
      dropQueue();
      return ok();
    },

    retry,

    /** Starts the engine. Anything asked for before this happens when it's up. */
    start(): void {
      supervisor.start();
    },

    /** Audio stops now. Nothing waits for it, and nothing is left to wait for. */
    quit(): void {
      deps.listening?.stopped();
      stopListening();
      if (eqSettling !== null) clearTimeout(eqSettling);
      supervisor.stop();
      engine = null;
    },
  };
}
