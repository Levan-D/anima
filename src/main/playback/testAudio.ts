/* For the tests against the real mpv: generated audio, what it decodes to alone, and a Player that really plays. Silent. */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AppSettings, Notice, PlayerPosition, PlayerState } from '@shared/domain';
import type { PlayableTrack } from '@main/library/queries';
import { ffmpeg, tempDir } from '@main/library/testFixtures';
import { MPV_FLAGS, spawnMpv, type SpawnedMpv } from './mpvProcess';
import { createPlayer, type Player, type PlayerDeps } from './player';
import { makeLibrary, makePlayable, makeSettings } from './testFixtures';

export const MPV_PATH = resolve('resources/mpv/mpv.exe');
export const HAS_MPV = existsSync(MPV_PATH);

export type ToneOptions = {
  frequency: number;
  seconds: number;
  /** Below full scale, so a positive gain has room to show. */
  volume?: number;
  tags?: Record<string, string>;
  rate?: number;
};

/** A stereo tone, 16-bit, in the format the extension says. */
export function makeStereoTone(
  path: string,
  { frequency, seconds, volume = 0.25, tags = {}, rate = 44_100 }: ToneOptions,
): void {
  ffmpeg(
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=${frequency}:duration=${seconds}:sample_rate=${rate}`,
    '-af',
    `volume=${volume}`,
    '-ac',
    '2',
    '-sample_fmt',
    's16',
    ...Object.entries(tags).flatMap(([key, value]) => ['-metadata', `${key}=${value}`]),
    path,
  );
}

const DECODE_FLAGS = MPV_FLAGS.filter(
  (flag) => flag !== '--input-ipc-client=fd://3' && flag !== '--idle=yes' && flag !== '--replaygain=album',
);

/**
 * What a file decodes to with nothing else going on. `format` is what the PCM writer is told, as in the spike: s32 for
 * comparing bytes, float for measuring level.
 */
export function decodeAlone(input: string, format: 's16' | 's32' | 'float' | 'double', args: string[] = []): Buffer {
  const output = join(tempDir('decode'), 'alone.pcm');
  const result = spawnSync(
    MPV_PATH,
    [
      ...DECODE_FLAGS,
      '--replaygain=no',
      '--ao=pcm',
      `--ao-pcm-file=${output}`,
      '--ao-pcm-waveheader=no',
      `--audio-format=${format}`,
      ...args,
      input,
    ],
    { stdio: 'ignore', windowsHide: true },
  );
  if (result.status !== 0) throw new Error(`Decoding ${input} failed with ${result.status}`);
  return readFileSync(output);
}

/** Flags for writing a run to a file instead of a device. The writer goes as fast as it can, far faster than real time. */
export function pcmArgs(file: string, format: 's32' | 'float', extra: string[] = []): string[] {
  return ['--ao=pcm', `--ao-pcm-file=${file}`, '--ao-pcm-waveheader=no', `--audio-format=${format}`, ...extra];
}

export function floatsOf(bytes: Buffer): Float32Array {
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Float32Array(copy, 0, Math.floor(bytes.length / 4));
}

export function rms(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

export function decibels(level: number, reference: number): number {
  return 20 * Math.log10(level / reference);
}

/** Null if they match. Otherwise the first byte they differ at, and how long each is, for the failure message. */
export function firstDifference(
  actual: Buffer,
  expected: Buffer,
): { at: number; actual: number; expected: number } | null {
  const shared = Math.min(actual.length, expected.length);
  if (actual.length === expected.length && actual.compare(expected) === 0) return null;
  for (let at = 0; at < shared; at++) {
    if (actual[at] !== expected[at]) return { at, actual: actual.length, expected: expected.length };
  }
  return { at: shared, actual: actual.length, expected: expected.length };
}

export type FileTrack = PlayableTrack & { path: string };

/** A track for a generated file. */
export function fileTrack(
  id: number,
  path: string,
  range: Partial<PlayableTrack['range']> = {},
  durationMs = 200_000,
): FileTrack {
  return { ...makePlayable(id, range, { durationMs }), path };
}

export type RealPlayer<L = PlayerDeps['library']> = {
  player: Player;
  library: L;
  settings: ReturnType<typeof makeSettings>;
  states: PlayerState[];
  positions: PlayerPosition[];
  notices: Omit<Notice, 'id'>[];
  /** Every mpv it has started, newest last. */
  spawned: SpawnedMpv[];
  /** Every command it has sent to the newest one. */
  sent: () => unknown[][];
  /** What mpv itself says, without the Player knowing it was asked. */
  ask: (property: string) => Promise<unknown>;
  until: (check: (state: PlayerState) => boolean, what: string, timeoutMs?: number) => Promise<PlayerState>;
  stop: () => void;
};

/** The whole Player on the real mpv and any library, with `args` deciding where the sound goes: it's never a device. */
export function startRealPlayerOn<L extends PlayerDeps['library']>(
  library: L,
  args: string[],
  settingsOverrides: Partial<AppSettings> = {},
  extraDeps: Pick<PlayerDeps, 'resume' | 'suggest'> = {},
): RealPlayer<L> {
  const settings = makeSettings(settingsOverrides);
  const states: PlayerState[] = [];
  const positions: PlayerPosition[] = [];
  const notices: Omit<Notice, 'id'>[] = [];
  const spawned: SpawnedMpv[] = [];
  const written: unknown[][][] = [];
  const waiting = new Set<() => void>();
  const asking = new Map<number, (value: unknown) => void>();
  let nextAsk = 1_000_000;
  let write: (line: string) => void = () => {};

  const player = createPlayer({
    settings,
    library,
    emit: (event, payload) => {
      if (event === 'player.state') states.push(payload as PlayerState);
      if (event === 'player.position') positions.push(payload as PlayerPosition);
      for (const check of waiting) check();
    },
    notify: (level, message, action) => notices.push({ level, message, action }),
    log: { warn: () => {}, error: () => {} },
    now: Date.now,
    enginePath: MPV_PATH,
    engineArgs: args,
    ...extraDeps,
    spawnEngine: (path, spawnArgs) => {
      const mpv = spawnMpv(path, spawnArgs);
      const commands: unknown[][] = [];
      written.push(commands);
      spawned.push(mpv);
      write = (line) => mpv.connection.write(line);
      return {
        ...mpv,
        connection: {
          ...mpv.connection,
          write(line) {
            commands.push((JSON.parse(line) as { command: unknown[] }).command);
            mpv.connection.write(line);
          },
          onData(listener) {
            let partial = '';
            mpv.connection.onData((chunk) => {
              partial += chunk.toString('utf8');
              const lines = partial.split('\n');
              partial = lines.pop() ?? '';
              for (const line of lines) {
                const reply = JSON.parse(line) as { request_id?: number; data?: unknown };
                if (reply.request_id !== undefined) asking.get(reply.request_id)?.(reply.data ?? null);
              }
              listener(chunk);
            });
          },
        },
      };
    },
  });
  player.start();

  return {
    player,
    library,
    settings,
    states,
    positions,
    notices,
    spawned,
    sent: () => written.at(-1) ?? [],
    ask: (property) =>
      new Promise((done) => {
        const id = nextAsk++;
        asking.set(id, done);
        write(`${JSON.stringify({ command: ['get_property', property], request_id: id })}\n`);
      }),
    until: (check, what, timeoutMs = 30_000) =>
      new Promise((done, fail) => {
        const look = () => {
          const state = player.state();
          if (!check(state)) return;
          clearTimeout(timer);
          waiting.delete(look);
          done(state);
        };
        const timer = setTimeout(() => {
          waiting.delete(look);
          fail(new Error(`Timed out waiting for ${what}. The state is ${JSON.stringify(player.state())}`));
        }, timeoutMs);
        waiting.add(look);
        look();
      }),
    stop: () => player.quit(),
  };
}

/** The writer closes its file a moment after the queue ends, once the last of the audio has gone through. */
export async function finishedWriting(file: string): Promise<Buffer> {
  let lastSize = -1;
  for (let stable = 0; stable < 4;) {
    await new Promise((done) => setTimeout(done, 50));
    const size = statSync(file, { throwIfNoEntry: false })?.size ?? 0;
    stable = size === lastSize ? stable + 1 : 0;
    lastSize = size;
  }
  return readFileSync(file);
}

/** The same, on tracks that are generated files. */
export function startRealPlayer(
  tracks: FileTrack[],
  args: string[],
  settingsOverrides: Partial<AppSettings> = {},
  extraDeps: Pick<PlayerDeps, 'resume' | 'suggest'> = {},
) {
  const paths = new Map(tracks.map(({ track, path }) => [track.id, path]));
  return startRealPlayerOn(
    makeLibrary(tracks, (trackId) => paths.get(trackId) ?? null),
    args,
    settingsOverrides,
    extraDeps,
  );
}
