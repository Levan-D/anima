/*
 * Picking up where it left off. Nothing opens until Play, because mpv opens its output for a paused file too: in exclusive
 * mode that would take the device at startup and silence every other app before anyone pressed anything.
 */

import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { tempDir } from '@main/library/testFixtures';
import type { ResumeStore, SavedResume } from './resumeStore';
import {
  decodeAlone,
  fileTrack,
  finishedWriting,
  firstDifference,
  HAS_MPV,
  makeStereoTone,
  pcmArgs,
  startRealPlayer,
  type FileTrack,
  type RealPlayer,
} from './testAudio';
import { makeHarness } from './testFixtures';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

function savedAs(saved: Partial<SavedResume> = {}): ResumeStore {
  const place: SavedResume = {
    trackIds: [1, 2, 3],
    index: 1,
    addedEnd: 0,
    positionMs: 42_000,
    radio: null,
    from: null,
    ...saved,
  };
  return { load: () => place, saveQueue: () => {}, savePlace: () => {} };
}

async function restored(settings: Parameters<typeof makeHarness>[0] = {}, saved: Partial<SavedResume> = {}) {
  const harness = makeHarness({
    settings: { outputMode: 'exclusive' },
    deps: { resume: savedAs(saved) },
    ...settings,
  });
  harness.player.start();
  await harness.settle();
  return harness;
}

describe('restoring', () => {
  it('shows the place, paused, with nothing opened', async () => {
    const harness = await restored();
    const { player, mpv } = harness;
    expect(mpv().sent('loadfile')).toEqual([]);
    expect(mpv().properties.get('audio-exclusive')).toBe(true);
    expect(player.state()).toMatchObject({ status: 'paused', queueIndex: 1, queueLength: 3, outputMode: 'exclusive' });
    expect(player.state().current?.id).toBe(2);
    expect(player.position().positionMs).toBe(42_000);
    expect(player.state().signal.kind).toBeNull();
    expect(harness.notices).toEqual([]);
  });

  it('comes back knowing the playlist it was played from, and saves it with the queue', async () => {
    const fromPlaylist = { kind: 'playlist', playlistId: 7 } as const;
    const harness = await restored({}, { from: fromPlaylist });
    expect(harness.player.state().from).toEqual(fromPlaylist);

    const saved: unknown[] = [];
    const saving = makeHarness({
      deps: { resume: { load: () => null, saveQueue: (...args) => saved.push(args.at(-1)), savePlace: () => {} } },
    });
    saving.player.start();
    await saving.settle();
    saving.player.play([1, 2], 0, fromPlaylist);
    await saving.settle();
    expect(saved.at(-1)).toEqual(fromPlaylist);
  });

  it('opens on Play, from there, with the pause already off', async () => {
    const harness = await restored();
    const { player, mpv } = harness;
    player.toggle();
    await harness.settle();
    const commands = mpv().commands.filter(([name, what]) => name === 'loadfile' || what === 'pause');
    expect(commands.at(-3)).toEqual(['set_property', 'pause', false]);
    expect(commands.at(-2)).toEqual(['loadfile', 'D:\\Music\\2.flac', 'replace', -1, 'start=42.000']);
    expect(commands.at(-1)).toMatchObject(['loadfile', 'D:\\Music\\3.flac', 'append']);
    expect(player.state().status).toBe('loading');
    mpv().startCurrent();
    expect(player.state().status).toBe('playing');
  });

  it('is the same in shared mode', async () => {
    const harness = await restored({ settings: { outputMode: 'shared' } });
    expect(harness.mpv().sent('loadfile')).toEqual([]);
    expect(harness.player.state().status).toBe('paused');
  });

  it('opens at a seek made while waiting, and doesn’t ask mpv to seek', async () => {
    const harness = await restored();
    const { player, mpv } = harness;
    player.seek(5000);
    await harness.settle();
    expect(player.position().positionMs).toBe(5000);
    expect(mpv().sent('loadfile')).toEqual([]);
    expect(mpv().sent('seek')).toEqual([]);
    player.resume();
    await harness.settle();
    expect(mpv().sent('loadfile')[0]).toEqual(['loadfile', 'D:\\Music\\2.flac', 'replace', -1, 'start=5.000']);
    mpv().startCurrent();
    await harness.settle();
    expect(mpv().sent('seek')).toEqual([]);
  });

  it('stays closed through Stop, Next and Previous', async () => {
    const harness = await restored();
    const { player, mpv } = harness;
    player.stop();
    await harness.settle();
    expect(player.position().positionMs).toBe(0);

    player.next();
    await harness.settle();
    expect(player.state()).toMatchObject({ status: 'paused', queueIndex: 2 });

    player.previous();
    await harness.settle();
    expect(player.state()).toMatchObject({ status: 'paused', queueIndex: 1 });
    expect(mpv().sent('loadfile')).toEqual([]);

    player.resume();
    await harness.settle();
    expect(mpv().sent('loadfile')[0]).toEqual(['loadfile', 'D:\\Music\\2.flac', 'replace']);
  });

  it('stays closed when the output mode changes, and through a new mpv', async () => {
    const harness = await restored({ settings: { outputMode: 'shared' } });
    const { player, mpv, spawned } = harness;
    player.setOutputMode('exclusive');
    await harness.settle();
    expect(mpv().sent('loadfile')).toEqual([]);

    mpv().exit();
    await harness.settle();
    expect(spawned).toHaveLength(2);
    expect(mpv().sent('loadfile')).toEqual([]);
    expect(mpv().properties.get('audio-exclusive')).toBe(true);
    expect(player.state().status).toBe('paused');
    expect(player.position().positionMs).toBe(42_000);
  });

  it('opens straight away when something else is played instead', async () => {
    const harness = await restored();
    const { player, mpv } = harness;
    player.play([4], 0);
    await harness.settle();
    expect(mpv().sent('loadfile')).toEqual([['loadfile', 'D:\\Music\\4.flac', 'replace']]);
    expect(player.state().status).toBe('loading');
  });

  it('restarts from the top when the current item is chosen again', async () => {
    const harness = await restored();
    const { player, mpv } = harness;
    player.playQueueIndex(1);
    await harness.settle();
    expect(mpv().sent('loadfile')[0]).toEqual(['loadfile', 'D:\\Music\\2.flac', 'replace']);
    expect(mpv().properties.get('pause')).toBe(false);
  });

  it('falls back to shared if the device refuses on Play, and stays at the place', async () => {
    const harness = await restored();
    const { player, mpv, settings, notices } = harness;
    player.resume();
    await harness.settle();
    const entry = mpv().entry(0);
    mpv().startFile(entry.id);
    mpv().fileLoaded();
    mpv().endFile(entry.id, 'error', 'audio output initialization failed');
    await harness.settle();
    expect(settings.get().outputMode).toBe('shared');
    expect(notices).toHaveLength(1);
    expect(mpv().sent('loadfile').at(-2)).toEqual(['loadfile', 'D:\\Music\\2.flac', 'replace', -1, 'start=42.000']);
  });
});

describe.skipIf(!HAS_MPV)('restoring on the real mpv', () => {
  let dir: string;
  let tracks: FileTrack[];
  let running: RealPlayer | null = null;

  beforeAll(() => {
    dir = tempDir('player-resume');
    tracks = [1, 2].map((id) => {
      const path = join(dir, `${id}.flac`);
      makeStereoTone(path, { frequency: 300 + id * 111, seconds: 20 });
      return fileTrack(id, path, {}, 20_000);
    });
  });

  afterEach(() => {
    running?.stop();
    running = null;
  });

  const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

  // The reason for all of this, and how to tell. `current-ao` is only there while an output is open.
  it('opens its output for a paused file, as the control', async () => {
    running = startRealPlayer(tracks, ['--ao=null'], { replayGainMode: 'off', outputMode: 'exclusive' });
    await wait(50);
    expect(await running.ask('current-ao')).toBeNull();
    running.player.play([1], 0);
    running.player.pause();
    await running.until(({ status }) => status === 'paused', 'the file to open');
    await running.until(({ signal }) => signal.output !== null, 'the output');
    expect(await running.ask('current-ao')).toBe('null');
  });

  it('has no output open until Play', async () => {
    running = startRealPlayer(
      tracks,
      ['--ao=null'],
      { replayGainMode: 'off', outputMode: 'exclusive' },
      { resume: savedAs({ trackIds: [1, 2], index: 0, positionMs: 10_000 }) },
    );
    await wait(300);
    expect(running.player.state().status).toBe('paused');
    expect(await running.ask('current-ao')).toBeNull();
    expect(await running.ask('path')).toBeNull();
    expect(running.sent().filter(([name]) => name === 'loadfile')).toEqual([]);

    running.player.resume();
    await running.until(({ status }) => status === 'playing', 'it to play');
    await running.until(({ signal }) => signal.output !== null, 'the output');
    expect(await running.ask('current-ao')).toBe('null');
    expect(Number(await running.ask('time-pos'))).toBeGreaterThanOrEqual(9.9);
  });

  it('plays from the saved place to the sample, byte-identical to that file started there', async () => {
    const file = join(dir, 'restored.pcm');
    running = startRealPlayer(
      tracks,
      pcmArgs(file, 's32'),
      { replayGainMode: 'off', outputMode: 'exclusive' },
      { resume: savedAs({ trackIds: [1], index: 0, positionMs: 10_000 }) },
    );
    await wait(300);
    running.player.resume();
    await running.until(({ status }) => status === 'ended', 'the end of the queue');
    const output = await finishedWriting(file);
    const fromThere = decodeAlone(tracks[0]?.path ?? '', 's32', ['--start=10']);
    expect(firstDifference(output, fromThere)).toBeNull();
    expect(output.length).toBe(10 * 44_100 * 2 * 4);
  });
});
