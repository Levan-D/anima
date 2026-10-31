/* Starts mpv, keeps it running, and gives up when it can't. Knows nothing about what it's playing. */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { Duplex } from 'node:stream';
import { createMpvClient, type MpvClient, type MpvConnection, type MpvEvent } from './mpvClient';

const QUICK_FAILURE_MS = 10_000;
const MAX_QUICK_FAILURES = 3;

export const MPV_FLAGS = [
  '--input-ipc-client=fd://3',
  '--no-config',
  '--idle=yes',
  '--vid=no',
  '--audio-display=no',
  '--cover-art-auto=no',
  '--terminal=no',
  '--load-scripts=no',
  '--osc=no',
  '--ytdl=no',
  '--input-default-bindings=no',
  '--input-vo-keyboard=no',
  '--input-media-keys=no',
  '--media-controls=no',
  // Not 'yes': that resamples later files to the first file's rate, which breaks exclusive mode's real-rate output.
  '--gapless-audio=weak',
  '--prefetch-playlist=yes',
  '--replaygain=album',
];

export type SpawnedMpv = {
  connection: MpvConnection;
  /** Once, when it has exited or never got going. */
  onExit(listener: () => void): void;
  kill(): void;
};

export type SpawnMpv = (path: string, args: string[]) => SpawnedMpv;

export type EngineProblem = 'missing' | 'crashing';

export type Logger = {
  warn: (...details: unknown[]) => void;
  error: (...details: unknown[]) => void;
};

export type MpvProcessDeps = {
  path: string;
  extraArgs: string[];
  spawn?: SpawnMpv;
  exists?: (path: string) => boolean;
  now: () => number;
  log: Logger;
  onEvent: (event: MpvEvent) => void;
  /** A new mpv, with nothing loaded and none of the settings applied. */
  onReady: (client: MpvClient) => void;
  /** The one it had is gone. `onReady` or `onUnavailable` comes next. */
  onLost: () => void;
  onUnavailable: (problem: EngineProblem) => void;
};

export type MpvProcess = {
  start(): void;
  /** After `onUnavailable`: starts over, with the count of failures forgotten. */
  retry(): void;
  /** For quitting. Audio stops now, and nothing waits for anything. */
  stop(): void;
};

/** For development and tests: `--ao=null` keeps a run silent. */
export function mpvArgsFromEnv(value = process.env.MUSIC_PLAYER_MPV_ARGS): string[] {
  return value?.trim().split(/\s+/).filter(Boolean) ?? [];
}

export function spawnMpv(path: string, args: string[]): SpawnedMpv {
  const child = spawn(path, args, { stdio: ['ignore', 'ignore', 'ignore', 'overlapped'], windowsHide: true });
  // Node has no type for an overlapped stdio entry. It's a socket, and mpv hears nothing else.
  const socket = child.stdio[3] as Duplex;
  // A write that was on its way when mpv went. Its exit is what gets acted on.
  socket.on('error', () => {});
  socket.once('close', () => child.kill());

  return {
    connection: {
      write(line) {
        if (!socket.destroyed) socket.write(line);
      },
      onData: (listener) => socket.on('data', listener),
      onClose: (listener) => socket.once('close', listener),
      destroy: () => socket.destroy(),
    },
    onExit(listener) {
      let isGone = false;
      const gone = () => {
        if (isGone) return;
        isGone = true;
        listener();
      };
      child.once('exit', gone);
      // A process that never started has no exit to wait for. An error from a live one is only a failed kill.
      child.once('error', () => {
        if (child.pid === undefined) gone();
      });
    },
    kill: () => child.kill(),
  };
}

export function createMpvProcess(deps: MpvProcessDeps): MpvProcess {
  const { path, extraArgs, spawn: spawnProcess = spawnMpv, exists = existsSync, now, log } = deps;

  let running: { spawned: SpawnedMpv; client: MpvClient; startedAt: number } | null = null;
  let quickFailures = 0;
  let isStopped = false;

  function launch(): void {
    if (!exists(path)) {
      log.error('mpv is not at', path);
      deps.onUnavailable('missing');
      return;
    }

    let spawned: SpawnedMpv;
    try {
      spawned = spawnProcess(path, [...MPV_FLAGS, ...extraArgs]);
    } catch (error) {
      log.error('mpv could not be started', error);
      deps.onUnavailable('crashing');
      return;
    }

    const client = createMpvClient(spawned.connection, {
      onEvent: deps.onEvent,
      onHung() {
        log.error('mpv stopped answering, so it is being restarted');
        spawned.kill();
      },
      onMalformed: (line) => log.warn('mpv sent something unreadable', line),
    });
    const mine = { spawned, client, startedAt: now() };
    running = mine;
    spawned.onExit(() => {
      if (running === mine) onExit();
    });
    deps.onReady(client);
  }

  function onExit(): void {
    const gone = running;
    running = null;
    gone?.client.close();
    if (isStopped) return;

    const wasQuick = gone !== null && now() - gone.startedAt < QUICK_FAILURE_MS;
    quickFailures = wasQuick ? quickFailures + 1 : 0;
    log.warn('mpv exited unexpectedly', { quickFailures });
    deps.onLost();

    if (quickFailures >= MAX_QUICK_FAILURES) deps.onUnavailable('crashing');
    else launch();
  }

  return {
    start: launch,
    retry() {
      if (running !== null) return;
      quickFailures = 0;
      launch();
    },
    stop() {
      isStopped = true;
      const stopping = running;
      running = null;
      stopping?.client.close();
      stopping?.spawned.kill();
    },
  };
}
