/* The whole Player on the real mpv with --ao=null, in real time, so it stays short. Nothing here makes a sound. */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { tempDir } from '@main/library/testFixtures';
import { createPlayer } from './player';
import { spawnMpv } from './mpvProcess';
import {
  fileTrack,
  HAS_MPV,
  makeStereoTone,
  MPV_PATH,
  startRealPlayer,
  startRealPlayerOn,
  type FileTrack,
  type RealPlayer,
} from './testAudio';
import { makeLibrary, makeSettings } from './testFixtures';

vi.setConfig({ testTimeout: 300_000, hookTimeout: 120_000 });

const NULL_OUTPUT = ['--ao=null'];
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

describe.skipIf(!HAS_MPV)('the Player on real mpv', () => {
  let dir: string;
  let tracks: FileTrack[];
  let running: Pick<RealPlayer, 'stop'> | null = null;

  const start = (...args: Parameters<typeof startRealPlayer>) => {
    const started = startRealPlayer(...args);
    running = started;
    return started;
  };

  beforeAll(() => {
    dir = tempDir('player-mpv');
    const seconds = [8, 8, 3];
    tracks = seconds.map((length, index) => {
      const path = join(dir, `${index + 1}.flac`);
      makeStereoTone(path, { frequency: 300 + index * 100, seconds: length });
      return fileTrack(index + 1, path, {}, length * 1000);
    });
  });

  afterEach(() => {
    running?.stop();
    running = null;
  });

  afterAll(() => {
    running?.stop();
  });

  const ids = () => tracks.map(({ track }) => track.id);

  it('plays a file whose path is past the old 260 character limit', async () => {
    let folder = join(dir, 'long');
    while (folder.length < 260) folder = join(folder, 'a-rather-long-folder-name');
    mkdirSync(folder, { recursive: true });
    const path = join(folder, 'tone.flac');
    makeStereoTone(path, { frequency: 440, seconds: 3 });
    const { player, until, notices } = start([fileTrack(9, path, {}, 3000)], NULL_OUTPUT);
    player.play([9], 0);
    const playing = await until(({ status }) => status === 'playing', 'playing');
    expect(playing.current?.id).toBe(9);
    expect(notices).toEqual([]);
  });

  it('plays, reports what it is playing, and relays position about five times a second', async () => {
    const { player, until, positions, states } = start(tracks, NULL_OUTPUT);
    expect(player.play(ids(), 0)).toEqual({ ok: true, value: undefined });
    expect(player.state().status).toBe('loading');

    const playing = await until(({ status }) => status === 'playing', 'playing');
    expect(playing.current?.id).toBe(1);
    expect(playing.queueIndex).toBe(0);
    expect(playing.queueLength).toBe(3);
    expect(playing.durationMs).toBe(8000);

    await until(({ signal }) => signal.decoded !== null && signal.output !== null, 'the signal path');
    expect(player.state().signal.decoded).toEqual({ sampleRate: 44_100, format: 's16', channels: 2 });

    positions.length = 0;
    await wait(2000);
    const inLoad = positions.filter(({ loadId }) => loadId === playing.loadId);
    expect(inLoad.length).toBeGreaterThanOrEqual(7);
    expect(inLoad.length).toBeLessThanOrEqual(12);
    const times = inLoad.map(({ positionMs }) => positionMs);
    expect(times).toEqual(times.toSorted((a, b) => a - b));
    expect(times.at(-1)).toBeGreaterThan(1000);

    // Nothing else went out for it.
    const statesDuring = states.filter((state) => state.status !== 'playing' || state.loadId !== playing.loadId);
    expect(statesDuring.every(({ status }) => status !== 'playing')).toBe(true);
  });

  it('pauses, holding its place, and carries on from there', async () => {
    const { player, until, positions } = start(tracks, NULL_OUTPUT);
    player.play(ids(), 0);
    await until(({ status }) => status === 'playing', 'playing');
    await wait(600);

    player.pause();
    expect(player.state().status).toBe('paused');
    await wait(100);
    const pausedAt = player.position().positionMs;
    positions.length = 0;
    await wait(500);
    expect(positions).toEqual([]);
    expect(player.position().positionMs).toBe(pausedAt);

    player.resume();
    expect(player.state().status).toBe('playing');
    await wait(600);
    expect(player.position().positionMs).toBeGreaterThan(pausedAt);
  });

  it('seeks, near the end included, without mpv ending the file', async () => {
    const { player, until, positions, notices } = start(tracks, NULL_OUTPUT);
    player.play(ids(), 0);
    await until(({ status }) => status === 'playing', 'playing');

    player.seek(4000);
    expect(positions.at(-1)?.positionMs).toBe(4000);
    await wait(300);
    expect(player.position().positionMs).toBeGreaterThanOrEqual(4000);
    expect(player.position().positionMs).toBeLessThan(5000);

    player.pause();
    player.seek(6000);
    await wait(300);
    expect(player.position().positionMs).toBe(6000);
    player.resume();

    player.seek(999_999);
    expect(positions.at(-1)?.positionMs).toBe(7500);
    // The buffered half second runs out, and the file ends the ordinary way rather than with mpv's error for a seek past it.
    await until(({ current }) => current?.id === 2, 'the next track', 5000);
    expect(notices).toEqual([]);
    expect(player.state().error).toBeNull();
  });

  it('says what it is doing to the signal, as settings change', async () => {
    const path = join(dir, 'tagged.flac');
    makeStereoTone(path, { frequency: 500, seconds: 8, tags: { REPLAYGAIN_TRACK_GAIN: '-6.00 dB' } });
    const tagged = fileTrack(30, path, {}, 8000);
    const { player, until } = start([tagged], NULL_OUTPUT, { replayGainMode: 'album', outputMode: 'shared' });
    player.play([30], 0);
    const gain = 'ReplayGain is changing the level';
    await until(({ signal }) => signal.alterations.includes(gain), 'ReplayGain to show');
    expect(player.state().signal.alterations).toEqual(['Windows is mixing', gain]);

    player.setReplayGainMode('off');
    expect(player.state().signal.alterations).toEqual(['Windows is mixing']);

    player.setOutputMode('exclusive');
    await until(({ signal }) => signal.isBitPerfect, 'bit-perfect');

    player.setVolume(50);
    expect(player.state().signal).toMatchObject({ isBitPerfect: false, alterations: ['Volume is below 100'] });
    player.setVolume(100);
    player.setMuted(true);
    expect(player.state().signal).toMatchObject({ isBitPerfect: false, alterations: ['Muted'] });
    player.setMuted(false);
    expect(player.state().signal.isBitPerfect).toBe(true);
    expect(player.state().status).toBe('playing');
  });

  it("takes up another music folder's settings when told the folder changed", async () => {
    const path = join(dir, 'tagged-elsewhere.flac');
    makeStereoTone(path, { frequency: 500, seconds: 8, tags: { REPLAYGAIN_TRACK_GAIN: '-6.00 dB' } });
    const tagged = fileTrack(31, path, {}, 8000);
    const { player, until, settings, sent } = start([tagged], NULL_OUTPUT, { replayGainMode: 'album' });
    player.play([31], 0);
    const gain = 'ReplayGain is changing the level';
    await until(({ signal }) => signal.alterations.includes(gain), 'ReplayGain to show');

    // What the settings store does on a new music folder: that folder's file comes in, and the Player is then told.
    settings.update({ replayGainMode: 'off' });
    expect(player.takeUpLibrarySettings().ok).toBe(true);

    expect(sent()).toContainEqual(['set_property', 'replaygain', 'no']);
    expect(player.state().signal.alterations).not.toContain(gain);
  });

  it('moves with next and previous, and the third second rule holds', async () => {
    const { player, until, sent } = start(tracks, NULL_OUTPUT);
    player.play(ids(), 0);
    await until(({ status }) => status === 'playing', 'playing');

    const before = player.state().loadId;
    player.next();
    const second = await until(({ status, current }) => status === 'playing' && current?.id === 2, 'the second track');
    expect(second.loadId).toBeGreaterThan(before);
    expect(sent().filter(([name]) => name === 'playlist-next')).toHaveLength(1);

    await wait(300);
    player.previous();
    await until(({ status, current }) => status === 'playing' && current?.id === 1, 'back to the first');

    player.seek(4000);
    await wait(100);
    player.previous();
    await wait(200);
    expect(player.state().current?.id).toBe(1);
    expect(player.position().positionMs).toBeLessThan(1000);
  });

  it('goes through the queue by itself and stops at the end, keeping the last track', async () => {
    const { player, until } = start(tracks, NULL_OUTPUT);
    player.play([3, 3], 0);
    const started = await until(({ status }) => status === 'playing', 'playing');
    expect(started.queueIndex).toBe(0);

    await until(({ queueIndex }) => queueIndex === 1, 'the second copy', 10_000);
    const ended = await until(({ status }) => status === 'ended', 'the end of the queue', 10_000);
    expect(ended.current?.id).toBe(3);
    expect(ended.queueIndex).toBe(1);

    player.resume();
    const again = await until(({ status }) => status === 'playing', 'playing again');
    expect(again.queueIndex).toBe(0);
  });

  it('comes back from a killed mpv at the same place, with everything put back, and says nothing', async () => {
    const { player, until, spawned, sent, notices, states } = start(tracks, NULL_OUTPUT, {
      volume: 37,
      muted: true,
      replayGainMode: 'track',
      outputMode: 'exclusive',
    });
    player.play(ids(), 0);
    await until(({ status }) => status === 'playing', 'playing');
    await wait(1500);

    const killedAt = player.position().positionMs;
    const loadIdBefore = player.state().loadId;
    states.length = 0;
    spawned[0]?.kill();
    await until(({ status, loadId }) => status === 'playing' && loadId > loadIdBefore, 'the restart', 15_000);

    expect(spawned).toHaveLength(2);
    expect(notices).toEqual([]);
    expect(states.every(({ error }) => error === null)).toBe(true);
    expect(player.state().current?.id).toBe(1);

    const commands = sent();
    expect(commands).toContainEqual(['set_property', 'volume', 37]);
    expect(commands).toContainEqual(['set_property', 'mute', true]);
    expect(commands).toContainEqual(['set_property', 'replaygain', 'track']);
    expect(commands).toContainEqual(['set_property', 'audio-exclusive', true]);

    await wait(300);
    const position = player.position().positionMs;
    expect(position).toBeGreaterThanOrEqual(killedAt - 100);
    expect(position).toBeLessThan(killedAt + 2000);
  });

  it('stays paused after coming back, if it was paused', async () => {
    const { player, until, spawned } = start(tracks, NULL_OUTPUT);
    player.play(ids(), 0);
    await until(({ status }) => status === 'playing', 'playing');
    player.seek(3000);
    await wait(200);
    player.pause();
    const pausedAt = player.position().positionMs;

    const loadIdBefore = player.state().loadId;
    spawned[0]?.kill();
    await until(({ status, loadId }) => status === 'paused' && loadId > loadIdBefore, 'the restart', 15_000);
    await wait(300);
    expect(player.position().positionMs).toBe(pausedAt);
    expect(player.state().status).toBe('paused');
  });

  it('lands in the right place after rapid commands on the real thing', async () => {
    const queue = [1, 2, 1, 2, 1, 2, 1, 2];
    const { player, until, ask, sent } = start(tracks, NULL_OUTPUT);
    player.play(queue, 0);
    await until(({ status }) => status === 'playing', 'playing');

    for (let press = 0; press < 5; press++) player.next();
    player.seek(3000);
    player.setOutputMode('exclusive');
    player.setOutputMode('shared');
    player.setOutputMode('exclusive');
    await until(({ status, queueIndex }) => status === 'playing' && queueIndex === 5, 'the sixth track');
    await wait(300);

    const state = player.state();
    expect(state.outputMode).toBe('exclusive');
    expect(state.current?.id).toBe(2);
    expect(player.position().positionMs).toBeGreaterThanOrEqual(3000);
    expect(player.position().positionMs).toBeLessThan(5000);
    expect(await ask('audio-exclusive')).toBe(true);
    expect(await ask('playlist-count')).toBe(2);
    expect(await ask('path')).toBe(tracks[1]?.path);
    expect(await ask('playlist/1/filename')).toBe(tracks[0]?.path);
    // Fewer loads than presses: it only went to the place the last one landed.
    expect(sent().filter(([name]) => name === 'loadfile').length).toBeLessThanOrEqual(6);
  });

  it('holds the current entry and the next one, through a whole queue', async () => {
    const short = [1, 2, 3].map((id) => {
      const path = join(dir, `short-${id}.flac`);
      makeStereoTone(path, { frequency: 200 * id, seconds: 1 });
      return fileTrack(id + 40, path, {}, 1000);
    });
    const { player, until, ask } = start(short, NULL_OUTPUT);
    player.play([41, 42, 43, 41], 0);

    for (const [index, item] of [short[0], short[1], short[2], short[0]].entries()) {
      await until(({ queueIndex, status }) => queueIndex === index && status === 'playing', `item ${index}`, 10_000);
      await wait(100);
      expect(await ask('path')).toBe(item?.path);
      expect(await ask('playlist-count')).toBe(index === 3 ? 1 : 2);
    }
    await until(({ status }) => status === 'ended', 'the end', 10_000);
    await wait(600);
    expect(await ask('playlist-count')).toBe(0);
  });

  it('stays in step with mpv through a storm of commands', async () => {
    const short = Array.from({ length: 6 }, (_, index) => {
      const path = join(dir, `storm-${index}.flac`);
      makeStereoTone(path, { frequency: 200 + index * 50, seconds: 1.5 });
      return fileTrack(index + 50, path, {}, 1500);
    });
    const ids = short.map(({ track }) => track.id);
    const pathOf = new Map(short.map(({ track, path }) => [track.id, path]));
    const seeds = Number(process.env.PLAYER_STORM_RUNS ?? 1);

    for (let seed = 1; seed <= seeds; seed++) {
      // The same run every time, so a failure can be gone back to.
      let random = seed * 2_654_435_761;
      const roll = (below: number) => {
        random = (random * 1_597_334_677 + 12_345) % 4_294_967_296;
        return Math.floor((random / 4_294_967_296) * below);
      };

      const started = start(short, NULL_OUTPUT);
      const { player, until, ask, spawned, states } = started;
      const pickQueueId = () => {
        const queue = player.queue();
        return queue[roll(queue.length)]?.queueId ?? 1;
      };
      const commands = [
        () => player.next(),
        () => player.next(),
        () => player.previous(),
        () => player.toggle(),
        () => player.seek(roll(1800)),
        () => player.enqueue([ids[roll(ids.length)] as number], roll(2) === 0 ? 'next' : 'after-added'),
        () => player.removeFromQueue([pickQueueId()]),
        () => player.moveInQueue([pickQueueId()], roll(8)),
        () => player.playQueueIndex(roll(Math.max(1, player.state().queueLength))),
        () => player.setOutputMode(roll(2) === 0 ? 'shared' : 'exclusive'),
        () => player.setReplayGainMode(roll(2) === 0 ? 'off' : 'album'),
        () => player.setVolume(roll(101)),
        () => player.play(ids, roll(ids.length)),
      ];

      player.play(ids, 0);
      for (let step = 0; step < 150; step++) {
        commands[roll(commands.length)]?.();
        if (seed % 3 === 0 && step === 75) spawned.at(-1)?.kill();
        const pause = roll(4);
        if (pause > 0) await wait(pause * roll(25));

        const state = player.state();
        const queue = player.queue();
        expect(state.queueLength).toBe(queue.length);
        if (state.queueIndex !== null) expect(queue[state.queueIndex]?.track).toEqual(state.current);
        expect(state.error, `seed ${seed}, step ${step}`).toBeNull();

        // Once it has had a moment, what mpv holds is what the Player says it holds.
        if (step % 20 === 19) {
          await wait(150);
          const settled = player.state();
          if (settled.status === 'playing' || settled.status === 'paused') {
            const [playing, count] = [await ask('path'), await ask('playlist-count')];
            if (player.state().loadId === settled.loadId) {
              expect(playing, `seed ${seed}, step ${step}`).toBe(pathOf.get(settled.current?.id ?? -1));
              expect(count, `seed ${seed}, step ${step}`).toBeLessThanOrEqual(2);
            }
          }
        }
      }

      // Whatever it did, it has to be able to do this now, and mpv has to agree with it.
      player.setVolume(100);
      player.play(ids, 2);
      await until(({ status, current }) => status === 'playing' && current?.id === ids[2], `seed ${seed} playing`);
      await wait(100);
      expect(await ask('path'), `seed ${seed}`).toBe(pathOf.get(ids[2] as number));
      expect(await ask('playlist-count'), `seed ${seed}`).toBe(2);
      expect(await ask('playlist/1/filename'), `seed ${seed}`).toBe(pathOf.get(ids[3] as number));
      expect(await ask('pause'), `seed ${seed}`).toBe(false);

      await until(
        ({ queueIndex, status }) => queueIndex === 3 && status === 'playing',
        `seed ${seed} moving on`,
        10_000,
      );
      await wait(100);
      expect(await ask('path'), `seed ${seed}`).toBe(pathOf.get(ids[3] as number));
      expect(player.state().error).toBeNull();
      expect(states.at(-1)).toEqual(player.state());
      started.stop();
    }
  });

  it('quits at once, with nothing left running', async () => {
    const { player, until, spawned } = start(tracks, NULL_OUTPUT);
    player.play(ids(), 0);
    await until(({ status }) => status === 'playing', 'playing');
    const exited = new Promise<number>((done) => {
      const at = performance.now();
      spawned[0]?.onExit(() => done(performance.now() - at));
    });

    const at = performance.now();
    player.quit();
    expect(performance.now() - at).toBeLessThan(100);
    expect(await exited).toBeLessThan(2000);
  });

  it('skips a missing file, and tells a broken one apart', async () => {
    const missing = fileTrack(10, join(dir, 'not-there.flac'));
    const brokenPath = join(dir, 'broken.flac');
    writeFileSync(brokenPath, 'this is not a flac file at all '.repeat(100));
    const broken = fileTrack(11, brokenPath);

    const library = makeLibrary(
      [missing, broken, ...tracks],
      (trackId) => [missing, broken, ...tracks].find(({ track }) => track.id === trackId)?.path ?? null,
    );
    const started = startRealPlayerOn(library, NULL_OUTPUT);
    running = started;
    const { player, until, notices } = started;
    player.play([10, 11, 1], 0);
    const playing = await until(({ status, current }) => status === 'playing' && current?.id === 1, 'the good one');
    expect(playing.queueIndex).toBe(2);
    expect(library.missing).toEqual([10]);
    expect(notices.map(({ action }) => action)).toEqual([
      { kind: 'reveal-track', label: 'Reveal', trackId: 10 },
      { kind: 'reveal-track', label: 'Reveal', trackId: 11 },
    ]);
    expect(player.queue().map(({ track }) => track.isMissing)).toEqual([true, false, false]);
  });

  it('stops with an error after trying the whole queue', async () => {
    const missing = [20, 21, 22].map((id) => fileTrack(id, join(dir, `gone-${id}.flac`)));
    const { player, until, notices } = start(missing, NULL_OUTPUT);
    player.play([21, 22, 20], 1);
    const failed = await until(({ status }) => status === 'error', 'the error');
    expect(failed.error?.code).toBe('file_missing');
    expect(notices).toHaveLength(3);
  });

  it('falls back to shared when the output can’t open in exclusive, then asks for a retry, keeping its place', async () => {
    const badOutput = ['--ao=pcm', `--ao-pcm-file=${join(dir, 'no-such-folder', 'x.pcm')}`];
    const { player, until, notices, settings } = start(tracks, badOutput, { outputMode: 'exclusive' });
    player.play(ids(), 0);

    const failed = await until(({ status }) => status === 'error', 'the error');
    expect(failed.error?.code).toBe('device_busy');
    expect(failed.current?.id).toBe(1);
    expect(failed.queueIndex).toBe(0);
    expect(settings.get().outputMode).toBe('shared');
    expect(notices.map(({ level }) => level)).toEqual(['warning']);
    expect(notices[0]?.message).toContain("can't do exclusive");

    player.retry();
    await until(({ status }) => status === 'loading', 'the retry');
    const failedAgain = await until(({ status }) => status === 'error', 'the error again');
    expect(failedAgain.current?.id).toBe(1);
  });

  it('is unavailable, with the path, when the binary is not there', () => {
    const player = createPlayer({
      settings: makeSettings(),
      library: makeLibrary([]),
      emit: () => {},
      notify: () => {},
      log: { warn: () => {}, error: () => {} },
      now: Date.now,
      enginePath: join(dir, 'no-mpv-here.exe'),
      engineArgs: NULL_OUTPUT,
    });
    player.start();
    expect(player.state().status).toBe('unavailable');
    expect(player.state().error?.message).toContain('no-mpv-here.exe');
    expect(player.play([1], 0)).toMatchObject({ ok: false, error: { code: 'engine_unavailable' } });
    player.quit();
  });

  it('gives up on an engine that dies as soon as it starts, and comes back on retry', async () => {
    let breaks = true;
    const player = createPlayer({
      settings: makeSettings(),
      library: makeLibrary(tracks, (id) => tracks.find(({ track }) => track.id === id)?.path ?? null),
      emit: () => {},
      notify: () => {},
      log: { warn: () => {}, error: () => {} },
      now: Date.now,
      enginePath: MPV_PATH,
      engineArgs: NULL_OUTPUT,
      spawnEngine: (path, args) =>
        breaks ? spawnMpv(path, [...args, '--no-such-option-at-all']) : spawnMpv(path, args),
    });
    player.start();
    await vi.waitFor(() => expect(player.state().status).toBe('unavailable'), { timeout: 15_000, interval: 50 });
    expect(player.state().error?.code).toBe('engine_unavailable');

    breaks = false;
    expect(player.retry()).toEqual({ ok: true, value: undefined });
    player.play([1], 0);
    await vi.waitFor(() => expect(player.state().status).toBe('playing'), { timeout: 15_000, interval: 50 });
    player.quit();
  });
});
