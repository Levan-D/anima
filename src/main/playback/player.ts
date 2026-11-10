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
  QueueFrom,
  PlayerStatus,
  QueueItem,
  RadioPreview,
  RadioProblem,
  RadioEnergy,
  RadioStartFrom,
  RadioWithin,
  ReplayGainMode,
} from '@shared/domain';
import { clipDb, isEqAudible } from '@shared/eqCurve';
import type { Seasons } from '@shared/themes';
import type { EventPayload } from '@shared/ipc/contract';
import type { EventName } from '@shared/ipc/channels';
import { err, ok, type AppError, type Result } from '@shared/result';
import type { Library } from '@main/library/library';
import { clampSeek, indexAtPosition, isPartOfFile, runFrom, type RangedItem, type Run } from './cueBoundaries';
import { chainFor, nextEqStep, type EqChain, type EqStep, type HeldEq } from './eqChain';
import { endOption, fileOptions, planWindow, type HeldEntry, type WindowStep } from './gaplessWindow';
import { createJumpFade, JUMP_FADE_TIMES, type JumpFade, type JumpFadeTimes } from './jumpFade';
import type { MpvClient, MpvEvent } from './mpvClient';
import { createMpvProcess, mpvArgsFromEnv, type EngineProblem, type Logger, type SpawnMpv } from './mpvProcess';
import {
  applyTopUp,
  enterRadio,
  jumpOverIds,
  playedSeeds,
  RADIO_FILL,
  radioWindow,
  topUpAsk,
  topUpSource,
  trimPast,
  unplayedPickIds,
  type RadioStartAnswer,
  type SuggestAnswer,
  type SuggestAsk,
} from './queueTopUp';
import {
  clearItems,
  currentItem,
  EMPTY_QUEUE,
  enqueue as enqueueItems,
  jumpTo,
  jumpToItem,
  markFileMissing,
  moveItems,
  appendToEnd,
  removeItems,
  replaceQueue,
  restoreQueue,
  stepBack,
  stepForward,
  type Queue,
  type QueuedTrack,
} from './queue';
import type { PlayableTrack } from '@main/library/queries';
import type { ResumeStore, SavedRadio } from './resumeStore';
import { appliedGainDb, reopenWouldRestore, signalPath, type ReplayGainTags, type SignalInput } from './signalPath';

const MAX_CALM_NOTED = 40;
const POSITION_INTERVAL_MS = 200;
const REMEMBER_EVERY_MS = 5_000;
const RESTART_INSTEAD_OF_BACK_MS = 3_000;
// Pressing Next before this counts as not wanting to hear it.
const SKIP_BEFORE_MS = 30_000;
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
const ENDLESS_RAN_OUT = 'Endless found nothing similar to add';
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
  /** Suggests what radio and Endless add, from what's owned. It knows nothing about playing. */
  suggest?: (ask: SuggestAsk) => Promise<SuggestAnswer>;
  /** Where radio goes from with nothing playing. */
  pickRadioSeed?: () => number | null;
  /** Works out where a start from the drawer goes, and what follows it. */
  radioStart?: (from: RadioStartFrom, wander: number, energy: RadioEnergy, count: number) => Promise<RadioStartAnswer>;
  /** Where it had got to, for the next time it starts. */
  resume?: ResumeStore;
  /** How a jump chosen by hand goes quiet, or null for not at all. */
  jumpFade?: JumpFadeTimes | null;
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

/** Radio is the source: `queue` is radio's own, and the person's stays here, untouched, until it's wanted again. */
type RadioRun = {
  /** Where it started, when that was a description. Not kept across a restart. */
  origin: Float32Array | null;
  /** What it was started from, for the seasonal themes that count for it. Not kept across a restart either. */
  asked: readonly number[];
  /** What it never leaves, from what it was started from. */
  within: RadioWithin | null;
  skipped: number[];
  /** Fell off the back of its queue, and shouldn't come round again. */
  heard: number[];
};

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
  fade: JumpFade | null;
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
  // The output took its format with the EQ's chain in place, so that format is the EQ's doing and needn't outlast it.
  let isOutputFromEq = false;
  let gainTags: ReplayGainTags | null = null;
  let fileDurationMs: number | null = null;
  let listen = 0;

  let isToppingUp = false;
  let radioGeneration = 0;
  let toppedOutAt: number | null = null;
  let radioRun: RadioRun | null = null;
  /** Where the queue was played from. Radio taking over, or the queue going, leaves it with nowhere. */
  let queueFrom: QueueFrom | null = null;
  let isRadioStarting = false;
  let radioProblem: RadioProblem | null = null;
  // The barrel showed these, so pressing one has to carry on with exactly what it showed.
  let preview: { seedId: number; trackIds: number[] } | null = null;
  /** Tracks radio picked for being calmer. Only what's still in the queue gets looked up, so a dropped pick falls away. */
  let radioCalm: number[] = [];
  let previewAsking: { seedId: number; answer: Promise<Result<RadioPreview>> } | null = null;

  // For stopping after the whole queue has been tried, without going round forever on a queue that does play.
  let failedInARow = 0;
  let hasPlayed = false;
  const unplayable = new Set<number>();

  // Nothing gets saved until this library's saved place has been looked at, or the empty queue would replace it.
  let isRemembering = false;
  let rememberedVersion = -1;
  let rememberedIndex: number | null = null;
  let nextRememberAt = 0;
  // Next on a restored track that hasn't made a sound yet isn't skipping it.
  let isRestoredUnheard = false;
  // Restored and not played yet, so nothing is open. mpv opens its output for a paused file too, and in exclusive mode that
  // takes the device, and silences every other app, at startup.
  let isWaitingForPlay = false;

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
    if (isWaitingForPlay) return 'paused';
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

  function signalInput(): SignalInput {
    const { volume, muted, outputMode, replayGainMode, eq } = settings.get();
    return {
      decoded,
      output,
      outputMode,
      eqAudible: isEqAudible(eq),
      eqClipDb: clipDb(eq),
      replayGainDb: appliedGainDb(replayGainMode, gainTags),
      volume,
      muted,
    };
  }

  function state(): PlayerState {
    const current = currentItem(queue);
    const { volume, muted, outputMode, replayGainMode, eq, endless } = settings.get();
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
      endless,
      from: queueFrom,
      radio: {
        isSource: radioRun !== null,
        isStarting: isRadioStarting,
        problem: radioProblem,
        stationId: radioRun?.within?.kind === 'station' ? radioRun.within.stationId : null,
        ...(radioRun === null ? { past: [], upNext: [] } : radioWindow(queue)),
      },
      signal: signalPath(signalInput()),
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
    if (queueVersion !== rememberedVersion || queue.index !== rememberedIndex) remember();
  }

  // Remembering where it is, and picking up from there.

  function remember(): void {
    const { resume } = deps;
    if (resume === undefined || !isRemembering) return;

    // A queue that has run out would finish again the moment it's played, so it comes back at the start of its last track.
    const place = {
      index: queue.index,
      addedEnd: queue.addedEnd,
      positionMs: mode === 'ended' ? 0 : Math.round(positionMs),
    };
    if (queueVersion === rememberedVersion) {
      resume.savePlace(place);
    } else {
      resume.saveQueue(
        queue.items.map(({ track }) => track.id),
        place,
        savedRadio(),
        queueFrom,
      );
      rememberedVersion = queueVersion;
    }
    rememberedIndex = queue.index;
  }

  function savedRadio(): SavedRadio | null {
    return radioRun === null ? null : { skipped: radioRun.skipped, within: radioRun.within };
  }

  function restoreSavedRadio({ skipped, within }: SavedRadio): void {
    radioRun = { skipped, heard: [], origin: null, asked: [], within };
  }

  /** Once per library, as soon as it's open and mpv is up. Something already chosen by then wins over what was saved. */
  function restoreResume(): void {
    const { resume } = deps;
    if (resume === undefined || isRemembering || engine === null || library.status().state !== 'ready') return;
    isRemembering = true;
    if (queue.items.length > 0) return;

    const saved = resume.load();
    if (saved === null || saved.trackIds.length === 0) return;
    const tracks = library.playableTracks(saved.trackIds);
    if (!tracks.ok) return;

    const owned = new Map(tracks.value.filter(({ track }) => !track.isMissing).map((item) => [item.track.id, item]));
    const slots = saved.trackIds.map((id) => owned.get(id) ?? null);
    setQueue(restoreQueue(queue, slots, saved.index, saved.addedEnd));
    if (saved.radio !== null) restoreSavedRadio(saved.radio);
    queueFrom = saved.from;

    const current = currentItem(queue);
    if (current === null) {
      radioRun = null;
      sync();
      return;
    }
    const isSameTrack = saved.index !== null && slots[saved.index] !== null;
    positionMs = isSameTrack ? clampSeek(saved.positionMs, current.track.durationMs) : 0;
    resumeAtMs = positionMs;
    isRestoredUnheard = true;
    setPaused(true);
    isWaitingForPlay = true;
    loadId++;
    nextPositionAt = 0;
    begin();
    relayPosition({ force: true });
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
    return mode === 'active' && !isWaitingForPlay ? queue.index : null;
  }

  function plan(mine: Engine): WindowStep[] {
    // With nothing held after this file, mpv goes idle at its end, and the next load opens the output afresh. The next
    // stretch of the same file doesn't count, so a CUE album stays gapless until it's over.
    const isOtherFile = (item: RangedItem) => item.range.fileId !== currentItem(queue)?.range.fileId;
    return planWindow(
      queue.items,
      wantedIndex(),
      { ...mine, isMovingOn: mine.movingOn !== null },
      (item) => !unplayable.has(item.queueId) && !(isOtherFile(item) && isReopenDue(mine)),
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
        const oldAudioGone = isJump(step) ? mine.fade?.oldAudioGone() : null;
        if (oldAudioGone != null) {
          await oldAudioGone;
          continue;
        }
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
    topUp();
  }

  /** Radio's rolling list, or Endless when it's on. The answer goes at the end, so mpv's next entry follows by the usual path. */
  function topUp(): void {
    const { suggest } = deps;
    if (suggest === undefined || isToppingUp || isWaitingForPlay || isRadioStarting) return;
    const source = topUpSource(radioRun !== null, settings.get().endless);
    const ask = topUpAsk({
      queue,
      source,
      canAsk: mode === 'active' && toppedOutAt !== queueVersion,
      skipped: radioRun?.skipped ?? [],
      heard: radioRun?.heard ?? [],
    });
    if (ask === null) return;

    if (radioRun !== null) {
      const { queue: trimmed, dropped } = trimPast(queue);
      radioRun.heard.push(...dropped);
      setQueue(trimmed);
    }
    const generation = radioGeneration;
    isToppingUp = true;
    const asked = radioRun === null ? suggest(ask) : suggestRadio(suggest, ask, radioRun.origin);
    asked
      .then((answer) => addTopUp(answer, generation))
      .catch((error: unknown) => {
        log.warn('Nothing could be suggested', error);
        addTopUp({ trackIds: [], hasSignals: true }, generation);
      });
  }

  function noteCalmPicks(calmPicks: readonly number[] = []): void {
    radioCalm = [...radioCalm, ...calmPicks].slice(-MAX_CALM_NOTED);
  }

  function suggestRadio(
    suggest: NonNullable<PlayerDeps['suggest']>,
    ask: SuggestAsk,
    origin: Float32Array | null = null,
  ): Promise<SuggestAnswer> {
    const { radioWander, radioEnergy } = settings.get();
    const energy = radioEnergy.isOn ? { energy: { settings: radioEnergy, calm: radioCalm } } : {};
    const asked = ask.asked ?? radioRun?.asked ?? [];
    return suggest({ ...ask, wander: radioWander, origin, asked, within: radioRun?.within ?? null, ...energy }).then(
      (answer) => {
        noteCalmPicks(answer.calmPicks);
        return answer;
      },
    );
  }

  function addTopUp({ trackIds, hasSignals }: SuggestAnswer, generation: number): void {
    isToppingUp = false;
    // The queue it was asked about has been replaced, so the ask starts over for the one that's there now.
    if (generation !== radioGeneration) {
      topUp();
      return;
    }
    const source = topUpSource(radioRun !== null, settings.get().endless);
    if (source === null) return;

    const tracks = library.playableTracks(trackIds);
    const topped = applyTopUp(queue, tracks.ok ? tracks.value : []);
    if (topped === null) {
      toppedOutAt = queueVersion;
      // The Radio page says so for as long as it lasts, and only Endless has nowhere else to.
      if (source === 'endless') notify('info', ENDLESS_RAN_OUT, null);
      else radioProblem = hasSignals ? 'ran-out' : 'no-data';
      emitState();
      return;
    }

    const hadEnded = mode === 'ended';
    const firstNew = queue.items.length;
    setQueue(topped);
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

  /** The steps that make mpv leave what it's playing, which resets the output. */
  function isJump(step: WindowStep): boolean {
    if (step.kind === 'load') return step.mode === 'replace';
    return step.kind === 'stop' || step.kind === 'next' || step.kind === 'seek';
  }

  /** Only for what's chosen by hand. A track running into the next never comes here, so it stays gapless. */
  function quietenForJump(): void {
    const mine = engine;
    if (mine === null || mine.fade === null || mode !== 'active' || isWaitingForPlay) return;
    const isOpen = mine.isLoaded || mine.movedBySelf || mine.movingOn !== null;
    if (!isOpen && !mine.fade.isActive()) return;
    if (isPaused) mine.fade.silence();
    else mine.fade.fadeOut();
  }

  function onPlaybackRestart(mine: Engine): void {
    const step = plan(mine)[0];
    const isMoreToCome =
      mine.wantedSeekMs !== null || mine.lastStartedId !== mine.playingId || (step !== undefined && isJump(step));
    if (!isMoreToCome) mine.fade?.release({ immediately: isPaused });
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
        const oldAudioGone = mine.fade?.oldAudioGone();
        if (oldAudioGone != null) await oldAudioGone;
        const target = mine.wantedSeekMs;
        mine.wantedSeekMs = null;
        const reply = await send(mine, ['seek', target / 1000, 'absolute']);
        if (!reply.ok) mine.fade?.release({ immediately: true });
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

  /**
   * Weak gapless keeps the output in whatever it opened in, so the doubles of an EQ that's gone would stay for good. Going
   * idle closes it, after playing out what it has. Setting `gapless-audio=no` instead reopens mid-song, at the first frame
   * in the new format, and `ao-reload` or `audio-exclusive` drop what's buffered.
   */
  function isReopenDue(mine: Engine): boolean {
    return isOutputFromEq && mine.eq.spec === null && reopenWouldRestore(signalInput());
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
    isRestoredUnheard = false;
    loadId++;
    nextPositionAt = 0;
  }

  function setPaused(value: boolean): void {
    if (!value) isWaitingForPlay = false;
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
    remember();
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
    isRestoredUnheard = false;
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
      case 'playback-restart':
        onPlaybackRestart(mine);
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
      pump();
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
        pump();
        emitState();
        return;
      case 'audio-out-params': {
        const opened = toAudioFormat(data);
        if (opened !== null && opened.format !== output?.format) isOutputFromEq = mine.eq.spec !== null;
        output = opened ?? output;
        pump();
        emitState();
      }
    }
  }

  function onIdle(mine: Engine): void {
    decoded = null;
    output = null;
    mine.fade?.release({ immediately: true });

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

    const time = now();
    if (time >= nextRememberAt) {
      nextRememberAt = time + REMEMBER_EVERY_MS;
      remember();
    }
  }

  // A new mpv, a lost one, and no more of them.

  function onReady(client: MpvClient): void {
    const fadeTimes = deps.jumpFade === undefined ? JUMP_FADE_TIMES : deps.jumpFade;
    const mine: Engine = {
      client,
      fade:
        fadeTimes === null
          ? null
          : createJumpFade({
              times: fadeTimes,
              isExclusive: () => settings.get().outputMode === 'exclusive',
              volume: () => settings.get().volume,
              setVolume: (value) => void send(mine, ['set_property', 'volume', value]),
            }),
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
    restoreResume();
    sync();
  }

  function onLost(): void {
    engine?.fade?.dispose();
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
    quietenForJump();
    radioGeneration++;
    radioRun = null;
    queueFrom = null;
    isRadioStarting = false;
    radioProblem = null;
    preview = null;
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
    if (!isSameLibrary) {
      isRemembering = false;
      dropQueue();
    }
    restoreResume();
  });

  emittedState = JSON.stringify(state());

  // Commands.

  function play(trackIds: number[], startIndex: number, from: QueueFrom | null = null): Result<void> {
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

    quietenForJump();
    setPaused(false);
    radioGeneration++;
    // A list that's chosen is the source again, and replaces the queue the way playing a list always has.
    radioRun = null;
    queueFrom = from;
    isRadioStarting = false;
    radioProblem = null;
    arrive(replaceQueue(queue, tracks.value, start));
    unplayable.clear();
    begin();
    return ok();
  }

  // Radio as what plays next.

  function ownedTrack(trackId: number): PlayableTrack | null {
    const found = library.playableTracks([trackId]);
    const item = found.ok ? found.value[0] : undefined;
    return item === undefined || item.track.isMissing ? null : item;
  }

  function radioSeedId(): number | null {
    return currentItem(queue)?.track.id ?? preview?.seedId ?? deps.pickRadioSeed?.() ?? null;
  }

  async function askPreview(
    seedId: number,
    suggest: NonNullable<PlayerDeps['suggest']>,
  ): Promise<Result<RadioPreview>> {
    const isCurrent = currentItem(queue)?.track.id === seedId;
    const seeds = isCurrent ? playedSeeds(queue, radioRun?.skipped ?? []) : [seedId];
    const answer = await suggestRadio(suggest, {
      seeds,
      exclude: seeds,
      recent: seeds,
      count: RADIO_FILL.fillTo,
      asked: [seedId],
    }).catch((error: unknown): SuggestAnswer => {
      log.warn('Nothing could be suggested', error);
      return { trackIds: [], hasSignals: true };
    });
    const tracks = library.playableTracks(answer.trackIds);
    if (!tracks.ok) return tracks;
    const owned = tracks.value.filter(({ track }) => !track.isMissing).map(({ track }) => track);
    // An empty one isn't kept, so it's asked again once fingerprints have come in.
    if (owned.length > 0) preview = { seedId, trackIds: owned.map(({ id }) => id) };
    return ok({
      seed: ownedTrack(seedId)?.track ?? null,
      upNext: owned,
      problem: owned.length > 0 ? null : noMatchProblem(answer),
    });
  }

  function noMatchProblem({ hasSignals }: SuggestAnswer): RadioProblem {
    return hasSignals ? 'nothing-close' : 'no-data';
  }

  /** What the Radio page shows while radio isn't the source. Nothing here touches what's playing. */
  function radioPreview(): Promise<Result<RadioPreview>> {
    const { suggest } = deps;
    const seedId = radioSeedId();
    if (seedId === null) return Promise.resolve(ok({ seed: null, upNext: [], problem: 'nothing-close' }));
    if (suggest === undefined) return Promise.resolve(ok({ seed: null, upNext: [], problem: 'no-data' }));

    if (preview?.seedId === seedId) {
      const { trackIds } = preview;
      const tracks = library.playableTracks(trackIds);
      if (!tracks.ok) return Promise.resolve(tracks);
      return Promise.resolve(
        ok({
          seed: ownedTrack(seedId)?.track ?? null,
          upNext: tracks.value.filter(({ track }) => !track.isMissing).map(({ track }) => track),
          problem: null,
        }),
      );
    }
    if (previewAsking?.seedId === seedId) return previewAsking.answer;

    const answer = askPreview(seedId, suggest).finally(() => {
      if (previewAsking?.answer === answer) previewAsking = null;
    });
    previewAsking = { seedId, answer };
    return answer;
  }

  /** What the preview already chose after this one, if it chose anything about it at all. */
  function previewPicksAfter(seedId: number): number[] | null {
    if (preview === null) return null;
    if (preview.seedId === seedId) return preview.trackIds;
    const at = preview.trackIds.indexOf(seedId);
    return at < 0 ? null : preview.trackIds.slice(at + 1);
  }

  /** Radio takes over from this track. What it takes over from is saved the first time, and only then. */
  function takeOver(
    seed: PlayableTrack,
    pickIds: readonly number[],
    origin: Float32Array | null = null,
    isNewStation = false,
    asked: readonly number[] = [seed.track.id],
    within: RadioWithin | null = null,
  ): void {
    const current = currentItem(queue);
    const keepsCurrent = mode === 'active' && current?.track.id === seed.track.id;
    if (!keepsCurrent) noteSkip();

    const tracks = library.playableTracks([...pickIds]);
    const picks = (tracks.ok ? tracks.value : []).filter(({ track }) => !track.isMissing);
    const past = !isNewStation && !keepsCurrent && mode === 'active' ? current : null;
    const next = enterRadio(queue, { past, current: keepsCurrent ? current : seed, picks });

    radioRun = { skipped: radioRun?.skipped ?? [], heard: radioRun?.heard ?? [], origin, asked, within };
    queueFrom = null;
    radioGeneration++;
    isRadioStarting = false;
    radioProblem = null;
    toppedOutAt = null;
    preview = null;
    if (!keepsCurrent) quietenForJump();
    setPaused(false);
    if (keepsCurrent) setQueue(next);
    else arrive(next);
    begin();
  }

  function playRadio(trackId: number | null): Result<void> {
    const refused = refusedForEngine();
    if (refused !== null) return refused;
    const { suggest } = deps;
    if (suggest === undefined) return err('unexpected', "Radio isn't available");

    if (radioRun !== null) {
      if (trackId === null) return ok();
      const at = queue.items.findIndex(({ track }, index) => index > (queue.index ?? -1) && track.id === trackId);
      const anywhere = at < 0 ? queue.items.findIndex(({ track }) => track.id === trackId) : at;
      if (anywhere >= 0) return jumpInRadio(anywhere);
    }

    const seedId = trackId ?? radioSeedId();
    if (seedId === null) {
      radioProblem = 'nothing-close';
      emitState();
      return ok();
    }
    const seed = ownedTrack(seedId);
    if (seed === null) return err('not_found', "That track isn't on this device");

    radioProblem = null;
    const picks = previewPicksAfter(seedId);
    if (picks !== null) {
      takeOver(seed, picks);
      return ok();
    }

    // Nothing changes until the engine has answered, so a seed with no match leaves everything as it was.
    const generation = ++radioGeneration;
    isRadioStarting = true;
    emitState();
    const answered = (answer: SuggestAnswer) => {
      if (generation !== radioGeneration) return;
      const tracks = library.playableTracks(answer.trackIds);
      const owned = tracks.ok ? tracks.value.filter(({ track }) => !track.isMissing) : [];
      if (owned.length === 0) {
        isRadioStarting = false;
        radioProblem = noMatchProblem(answer);
        emitState();
        return;
      }
      takeOver(
        seed,
        owned.map(({ track }) => track.id),
      );
    };
    suggestRadio(suggest, {
      seeds: [seedId],
      exclude: [seedId],
      recent: [seedId],
      count: RADIO_FILL.fillTo,
      asked: [seedId],
    })
      .then(answered)
      .catch((error: unknown) => {
        log.warn('Nothing could be suggested', error);
        answered({ trackIds: [], hasSignals: true });
      });
    return ok();
  }

  /** From a description rather than a track, whatever's ahead goes. Nothing changes until the worker has answered. */
  function startRadio(from: RadioStartFrom, wander: number): Result<void> {
    const refused = refusedForEngine();
    if (refused !== null) return refused;
    const { radioStart } = deps;
    if (radioStart === undefined) return err('unexpected', "Radio isn't available");

    if (settings.get().radioWander !== wander) settings.update({ radioWander: wander });
    const generation = ++radioGeneration;
    isRadioStarting = true;
    radioProblem = null;
    emitState();
    const stopWith = (problem: RadioProblem) => {
      isRadioStarting = false;
      radioProblem = problem;
      emitState();
    };
    const answered = (answer: RadioStartAnswer) => {
      if (generation !== radioGeneration) return;
      if ('problem' in answer) {
        stopWith(answer.problem);
        return;
      }
      noteCalmPicks(answer.calmPicks);
      const seed = ownedTrack(answer.first);
      const picks = library.playableTracks(answer.trackIds);
      const owned = picks.ok ? picks.value.filter(({ track }) => !track.isMissing) : [];
      if (seed === null || owned.length === 0) {
        stopWith(noMatchProblem(answer));
        return;
      }
      takeOver(
        seed,
        owned.map(({ track }) => track.id),
        answer.origin,
        true,
        answer.asked,
        answer.within ?? null,
      );
    };
    radioStart(from, wander, settings.get().radioEnergy, RADIO_FILL.fillTo)
      .then(answered)
      .catch((error: unknown) => {
        log.warn('Radio could not start', error);
        answered({ problem: 'nothing-close' });
      });
    return ok();
  }

  function setRadioWander(wander: number): Result<void> {
    settings.update({ radioWander: wander });
    return repickRadio();
  }

  function setRadioEnergy(energy: RadioEnergy): Result<void> {
    settings.update({ radioEnergy: energy });
    return repickRadio();
  }

  function setSeasons(seasons: Seasons): Result<void> {
    settings.update({ seasons });
    return repickRadio();
  }

  /** A mood station that was changed, by the tuner or a mark while it plays. If it's the one playing, what's to come follows. */
  function retuneStation(stationId: number): Result<void> {
    const within = radioRun?.within ?? null;
    return within?.kind === 'station' && within.stationId === stationId ? repickRadio() : ok();
  }

  /** Picks to come are made with what's now set, and radio's own unplayed ones are made again. */
  function repickRadio(): Result<void> {
    preview = null;
    previewAsking = null;
    const { suggest } = deps;
    if (suggest === undefined || radioRun === null || isRadioStarting) return ok();

    const ask = topUpAsk({
      queue: removeItems(queue, unplayedPickIds(queue)),
      source: 'radio',
      canAsk: true,
      skipped: radioRun.skipped,
      heard: radioRun.heard,
    });
    if (ask === null) return ok();

    const generation = ++radioGeneration;
    isRadioStarting = true;
    emitState();
    const answered = ({ trackIds }: SuggestAnswer) => {
      if (generation !== radioGeneration) return;
      isRadioStarting = false;
      const tracks = library.playableTracks(trackIds);
      const owned = tracks.ok ? tracks.value.filter(({ track }) => !track.isMissing) : [];
      if (owned.length === 0) {
        emitState();
        return;
      }
      setQueue(appendToEnd(removeItems(queue, unplayedPickIds(queue)), owned));
      toppedOutAt = null;
      radioProblem = null;
      sync();
    };
    suggestRadio(suggest, ask, radioRun.origin)
      .then(answered)
      .catch((error: unknown) => {
        log.warn('Nothing could be suggested', error);
        answered({ trackIds: [], hasSignals: true });
      });
    return ok();
  }

  /** Forward, what it goes over is dropped, since those were never heard. Back, it's in the queue like any other. */
  function jumpInRadio(index: number): Result<void> {
    noteSkip();
    const target = queue.items[index];
    if (target === undefined) return ok();
    const remaining = removeItems(queue, jumpOverIds(queue, index));
    const moved = jumpToItem(remaining, target.queueId);
    if (moved === null) return ok();
    quietenForJump();
    setPaused(false);
    arrive(moved);
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
    } else if (mode === 'error' || isWaitingForPlay) {
      resumeAtMs = positionMs;
    } else if (engine?.atQueueId === current.queueId && engine.isLoaded) {
      if (!isPaused) quietenForJump();
      void seekEngine(engine, current.range.startMs + positionMs);
    } else {
      pendingSeekMs = positionMs;
    }
    remember();
    return ok();
  }

  function playQueueIndex(index: number): Result<void> {
    const refused = refusedForEngine();
    if (refused !== null) return refused;

    const target = jumpTo(queue, index);
    if (target === null) return err('not_found', "There's nothing at that place in the queue");

    if (mode === 'active' && index === queue.index) {
      // Ahead of the pause, so a track still waiting to open starts from the top rather than going there after it has.
      const sought = seek(0);
      setPaused(false);
      sync();
      return sought;
    }
    quietenForJump();
    setPaused(false);
    arrive(target);
    begin();
    return ok();
  }

  function noteSkip(): void {
    const skipped = currentItem(queue);
    if (skipped === null || mode !== 'active' || positionMs >= SKIP_BEFORE_MS || isRestoredUnheard) return;
    deps.listening?.skipped?.(skipped.track.id);
    radioRun?.skipped.push(skipped.track.id);
  }

  function next(): Result<void> {
    const refused = refusedForEngine();
    if (refused !== null) return refused;

    noteSkip();
    quietenForJump();

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

    quietenForJump();
    arrive(stepped);
    begin();
    return ok();
  }

  function pause(): Result<void> {
    if (mode !== 'active') return ok();
    setPaused(true);
    relayPosition({ force: true });
    emitState();
    remember();
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
      sync();
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

  /** Halted, at the start of the song, with the queue as it was. Play starts it from the top. */
  function stop(): Result<void> {
    const refused = refusedForEngine();
    if (refused !== null) return refused;

    if (currentItem(queue) === null) return ok();
    // An error is already silent, and Retry should still play.
    if (mode !== 'error') setPaused(true);
    const sought = seek(0);
    emitState();
    return sought;
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
      quietenForJump();
      arrive(remaining);
      if (after === null) {
        mode = 'idle';
        failure = null;
      }
    }
    if (after === null) radioRun = null;
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
    stop,
    next,
    previous,
    seek,

    setVolume(volume: number): Result<void> {
      settings.update({ volume });
      // A fade reads it at its next step.
      if (engine?.fade?.isActive() !== true) setProperty('volume', volume);
      pump();
      emitState();
      return ok();
    },

    setMuted(muted: boolean): Result<void> {
      settings.update({ muted });
      setProperty('mute', muted);
      pump();
      emitState();
      return ok();
    },

    setOutputMode(outputMode: OutputMode): Result<void> {
      if (settings.get().outputMode === outputMode) return ok();
      settings.update({ outputMode });
      // On its own this reopens the output, and a device that's busy comes back as a failed output like any other.
      setProperty('audio-exclusive', outputMode === 'exclusive');
      pump();
      emitState();
      return ok();
    },

    setReplayGainMode(replayGainMode: ReplayGainMode): Result<void> {
      settings.update({ replayGainMode });
      setProperty('replaygain', MPV_REPLAY_GAIN[replayGainMode]);
      pump();
      emitState();
      return ok();
    },

    setEndless(endless: boolean): Result<void> {
      settings.update({ endless });
      if (endless) toppedOutAt = null;
      sync();
      return ok();
    },

    /** The music folder changed, and its own EQ, ReplayGain, Endless, seasons and radio settings came with it. */
    takeUpLibrarySettings(): Result<void> {
      const { replayGainMode, endless } = settings.get();
      setProperty('replaygain', MPV_REPLAY_GAIN[replayGainMode]);
      if (endless) toppedOutAt = null;
      pump();
      sync();
      emitState();
      return repickRadio();
    },

    radioPreview,
    playRadio,
    startRadio,
    setRadioWander,
    setRadioEnergy,
    setSeasons,
    retuneStation,

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
      remember();
      deps.listening?.stopped();
      stopListening();
      if (eqSettling !== null) clearTimeout(eqSettling);
      engine?.fade?.dispose();
      supervisor.stop();
      engine = null;
    },
  };
}
