/* Gapless through radio, the way player.bytes.test.ts checks a queue: what mpv wrote against each file decoded alone. */

import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { tempDir } from '@main/library/testFixtures';
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

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });

describe.skipIf(!HAS_MPV)('bytes through radio', () => {
  let dir: string;
  let tracks: FileTrack[];
  let running: RealPlayer | null = null;

  const start = (...args: Parameters<typeof startRealPlayer>) => {
    running = startRealPlayer(...args);
    return running;
  };
  const decoded = (...ids: number[]) =>
    Buffer.concat(ids.map((id) => decodeAlone(tracks[id - 1]?.path ?? '', 's32')));

  beforeAll(() => {
    dir = tempDir('player-radio-bytes');
    // The writer outruns real time by far, and each has to outlast the round trips that swap in what's next. The first is
    // the longest, because taking over lets it go while that happens.
    tracks = [330, 440, 550, 660, 770].map((frequency, at) => {
      const path = join(dir, `radio-${at + 1}.flac`);
      const seconds = at === 0 ? 900 : 60;
      makeStereoTone(path, { frequency, seconds });
      return fileTrack(at + 1, path, {}, seconds * 1000);
    });
  });

  afterEach(() => {
    running?.stop();
    running = null;
  });

  /** Heard in real time there's a whole track to swap what's next in, so the swap gets as long as it needs here too. */
  const holdForTheWindow = async (player: RealPlayer['player']) => {
    player.pause();
    await new Promise((done) => setTimeout(done, 250));
  };

  /** One list of picks, then nothing. */
  const onePick = (picks: number[]) => {
    let asked = 0;
    return () => Promise.resolve({ trackIds: asked++ === 0 ? picks : [], hasSignals: true });
  };

  it('follows a pick byte for byte, with the track it took over from carrying on, and none of the old queue', async () => {
    const file = join(dir, 'takeover.pcm');
    const { player, until, sent, notices } = start(
      tracks,
      pcmArgs(file, 's32'),
      { replayGainMode: 'off' },
      { suggest: onePick([2, 3]) },
    );
    player.play([1, 5], 0);
    player.pause();
    await until(({ status }) => status === 'paused', 'the file to load');
    await player.radioPreview();

    player.playRadio(null);
    await holdForTheWindow(player);
    player.resume();
    await until(({ status, current }) => status === 'ended' && current?.id === 3, 'radio to run out');

    expect(notices).toEqual([]);
    expect(firstDifference(await finishedWriting(file), decoded(1, 2, 3))).toBeNull();
    expect(sent().filter(([name, , mode]) => name === 'loadfile' && mode === 'replace')).toHaveLength(1);
  });

  it('plays what was added by hand ahead of the next pick, gaplessly', async () => {
    const file = join(dir, 'added.pcm');
    const { player, until } = start(tracks, pcmArgs(file, 's32'), { replayGainMode: 'off' }, { suggest: onePick([2]) });
    player.play([1], 0);
    player.pause();
    await until(({ status }) => status === 'paused', 'the file to load');
    await player.radioPreview();
    player.playRadio(null);
    player.enqueue([4], 'after-added');
    await holdForTheWindow(player);
    player.resume();
    await until(({ status, current }) => status === 'ended' && current?.id === 2, 'radio to run out');

    expect(firstDifference(await finishedWriting(file), decoded(1, 4, 2))).toBeNull();
  });
});
