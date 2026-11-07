/* Radio as what decides what plays next, and Endless on the person's own queue, through the Player with a stand-in mpv. */

import { describe, expect, it } from 'vitest';
import type { PlayerDeps } from './player';
import type { ResumeStore, SavedResume } from './resumeStore';
import type { SuggestAnswer, SuggestAsk } from './queueTopUp';
import { makeHarness, makePlayable } from './testFixtures';

const TRACKS = Array.from({ length: 30 }, (_, at) => makePlayable(at + 1));

/** Hands out ids from 10 on, one list per ask. */
function engine(answer?: (ask: SuggestAsk) => SuggestAnswer) {
  const asks: SuggestAsk[] = [];
  let next = 10;
  const suggest: NonNullable<PlayerDeps['suggest']> = (ask) => {
    asks.push(ask);
    if (answer !== undefined) return Promise.resolve(answer(ask));
    const trackIds = Array.from({ length: ask.count }, () => next++).filter((id) => id <= 30);
    return Promise.resolve({ trackIds, hasSignals: true });
  };
  return { asks, suggest };
}

async function started(deps: Partial<PlayerDeps>, settings: Parameters<typeof makeHarness>[0] = {}) {
  const harness = makeHarness({ tracks: TRACKS, deps, ...settings });
  harness.player.start();
  await harness.settle();
  return harness;
}

const queueIds = (harness: Awaited<ReturnType<typeof started>>) => harness.player.queue().map(({ track }) => track.id);

describe('the preview', () => {
  it('changes nothing about what is playing', async () => {
    const { asks, suggest } = engine();
    const harness = await started({ suggest });
    harness.player.play([1, 2, 3], 1);
    await harness.settle();
    const before = harness.player.state();
    const loads = harness.mpv().sent('loadfile').length;

    const preview = await harness.player.radioPreview();
    await harness.settle();

    expect(preview).toMatchObject({ ok: true, value: { problem: null, seed: { id: 2 } } });
    expect(harness.player.state().queueVersion).toBe(before.queueVersion);
    expect(queueIds(harness)).toEqual([1, 2, 3]);
    expect(harness.player.state().radio.isSource).toBe(false);
    expect(harness.mpv().sent('loadfile')).toHaveLength(loads);
    expect(asks[0]?.seeds).toEqual([1, 2]);
  });

  it('goes from a recent play or a pick with nothing playing, and stays on it', async () => {
    const { suggest } = engine();
    let picks = 0;
    const harness = await started({
      suggest,
      pickRadioSeed: () => {
        picks++;
        return 7;
      },
    });
    const first = await harness.player.radioPreview();
    const second = await harness.player.radioPreview();
    expect(first.ok && first.value.seed?.id).toBe(7);
    expect(second).toEqual(first);
    expect(picks).toBe(1);
    expect(harness.player.state().status).toBe('idle');
  });

  it('says when there is nothing to go on, and asks again next time', async () => {
    let hasSignals = false;
    const harness = await started({
      suggest: () => Promise.resolve({ trackIds: hasSignals ? [9] : [], hasSignals }),
      pickRadioSeed: () => 7,
    });
    expect(await harness.player.radioPreview()).toMatchObject({ value: { problem: 'no-data', upNext: [] } });
    hasSignals = true;
    expect(await harness.player.radioPreview()).toMatchObject({ value: { problem: null, upNext: [{ id: 9 }] } });
  });
});

describe('taking over', () => {
  it('carries on with the track that is playing, replacing only what mpv holds next', async () => {
    const { suggest } = engine();
    const harness = await started({ suggest });
    harness.player.play([1, 2, 3], 0);
    await harness.settle();
    harness.mpv().startCurrent();
    const { loadId } = harness.player.state();
    const replaces = harness
      .mpv()
      .sent('loadfile')
      .filter(([, , mode]) => mode === 'replace').length;

    await harness.player.radioPreview();
    harness.player.playRadio(null);
    await harness.settle();

    const state = harness.player.state();
    expect(state.radio).toMatchObject({ isSource: true });
    expect(state.loadId).toBe(loadId);
    expect(state.current?.id).toBe(1);
    expect(state.radio.upNext.map(({ id }) => id)).toEqual([10, 11, 12, 13, 14, 15, 16, 17]);
    const loads = harness.mpv().sent('loadfile');
    expect(loads.filter(([, , mode]) => mode === 'replace')).toHaveLength(replaces);
    expect(loads.at(-1)).toMatchObject(['loadfile', 'D:\\Music\\10.flac', 'append']);
    expect(harness.mpv().sent('playlist-remove')).toHaveLength(1);
    expect(harness.mpv().playlist).toHaveLength(2);
  });

  it('plays a pressed track, drops what it went over, and leaves what was playing behind it', async () => {
    const { suggest } = engine();
    const harness = await started({ suggest });
    harness.player.play([1, 2], 0, { kind: 'playlist', playlistId: 7 });
    await harness.settle();
    harness.mpv().startCurrent();
    await harness.player.radioPreview();

    harness.player.playRadio(12);
    await harness.settle();

    const state = harness.player.state();
    expect(state.current?.id).toBe(12);
    // Radio is where it plays from now, not the playlist.
    expect(state.from).toBeNull();
    expect(state.radio.past.map(({ id }) => id)).toEqual([1]);
    expect(state.radio.upNext.slice(0, 2).map(({ id }) => id)).toEqual([13, 14]);
    expect(state.radio.upNext.map(({ id }) => id)).not.toContain(10);
  });

  it('plays the shown pick when nothing is playing', async () => {
    const { suggest } = engine();
    const harness = await started({ suggest, pickRadioSeed: () => 7 });
    await harness.player.radioPreview();
    harness.player.playRadio(null);
    await harness.settle();
    const state = harness.player.state();
    expect(state.current?.id).toBe(7);
    expect(state.radio).toMatchObject({ isSource: true });
  });

  it('leaves everything alone when the engine has no match for a seed', async () => {
    const harness = await started({ suggest: () => Promise.resolve({ trackIds: [], hasSignals: false }) });
    harness.player.play([1, 2], 0);
    await harness.settle();
    const { queueVersion } = harness.player.state();
    harness.player.playRadio(5);
    expect(harness.player.state().radio.isStarting).toBe(true);
    await harness.settle();
    expect(harness.player.state()).toMatchObject({ queueVersion, radio: { isSource: false, problem: 'no-data' } });
    expect(queueIds(harness)).toEqual([1, 2]);
  });

  it('keeps rolling from what was played, and counts a skip', async () => {
    const { asks, suggest } = engine();
    const skipped: number[] = [];
    const harness = await started({
      suggest,
      listening: { position: () => {}, stopped: () => {}, skipped: (id) => skipped.push(id) },
    });
    harness.player.play([1], 0);
    await harness.settle();
    harness.mpv().startCurrent();
    harness.player.playRadio(1);
    await harness.settle();
    harness.mpv().startCurrent();

    for (let step = 0; step < 4; step++) {
      harness.player.next();
      await harness.settle();
      harness.mpv().startCurrent();
      await harness.settle();
    }

    expect(skipped.length).toBeGreaterThan(0);
    const last = asks.at(-1);
    expect(last?.seeds).toEqual([13]);
    expect(harness.player.state().radio.upNext.length).toBeGreaterThanOrEqual(5);
  });

  it('plays what was added by hand before the next pick', async () => {
    const { suggest } = engine();
    const harness = await started({ suggest });
    harness.player.play([1], 0);
    await harness.settle();
    await harness.player.radioPreview();
    harness.player.playRadio(null);
    await harness.settle();

    harness.player.enqueue([5], 'after-added');
    harness.player.enqueue([6], 'after-added');
    await harness.settle();
    expect(
      harness.player
        .state()
        .radio.upNext.slice(0, 3)
        .map(({ id }) => id),
    ).toEqual([5, 6, 10]);
  });

  it('ends when a list is played from the Library, with no way back to what it replaced', async () => {
    const { suggest } = engine();
    const harness = await started({ suggest });
    harness.player.play([1, 2], 0);
    await harness.settle();
    await harness.player.radioPreview();
    harness.player.playRadio(null);
    await harness.settle();

    harness.player.play([3, 4], 0);
    await harness.settle();
    expect(harness.player.state().radio).toMatchObject({ isSource: false, upNext: [] });
    expect(queueIds(harness)).toEqual([3, 4]);
  });
});

describe('clearing radio', () => {
  it('leaves nothing, with what was queued before it gone', async () => {
    const { suggest } = engine();
    const harness = await started({ suggest });
    harness.player.play([1, 2, 3], 1);
    await harness.settle();
    harness.mpv().startCurrent();
    await harness.player.radioPreview();
    harness.player.playRadio(12);
    await harness.settle();

    harness.player.clearQueue();
    await harness.settle();

    expect(queueIds(harness)).toEqual([]);
    expect(harness.player.state().radio.isSource).toBe(false);
  });
});

describe('Endless', () => {
  it('never adds anything when off', async () => {
    const { asks, suggest } = engine();
    const harness = await started({ suggest });
    harness.player.play([1], 0);
    await harness.settle();
    expect(asks).toEqual([]);
    expect(queueIds(harness)).toEqual([1]);
    harness.mpv().startCurrent();
    harness.mpv().endFile(harness.mpv().playlist[0]?.id ?? 0, 'eof');
    await harness.settle();
    expect(harness.player.state().status).toBe('ended');
    expect(asks).toEqual([]);
  });

  it('adds to the end of the queue only as it is about to run out', async () => {
    const { asks, suggest } = engine();
    const harness = await started({ suggest }, { settings: { endless: true } });
    harness.player.play([1, 2, 3, 4], 0);
    await harness.settle();
    expect(asks).toEqual([]);

    harness.player.playQueueIndex(2);
    await harness.settle();
    expect(queueIds(harness)).toEqual([1, 2, 3, 4, 10, 11, 12]);
    expect(harness.player.state().radio.isSource).toBe(false);
  });

  it("doesn't keep asking when the engine has no match, and says so once", async () => {
    const { asks, suggest } = engine(() => ({ trackIds: [], hasSignals: true }));
    const harness = await started({ suggest }, { settings: { endless: true } });
    harness.player.play([1], 0);
    await harness.settle();
    harness.player.seek(1000);
    harness.player.pause();
    harness.player.resume();
    await harness.settle();
    expect(asks).toHaveLength(1);
    expect(harness.notices).toHaveLength(1);
  });

  it('starts when turned on, and is remembered', async () => {
    const { asks, suggest } = engine();
    const harness = await started({ suggest });
    harness.player.play([1], 0);
    await harness.settle();
    harness.player.setEndless(true);
    await harness.settle();
    expect(asks).toHaveLength(1);
    expect(harness.settings.get().endless).toBe(true);
    expect(harness.player.state().endless).toBe(true);
  });
});

describe('resuming', () => {
  it('comes back as radio, paused', async () => {
    const { asks, suggest } = engine();
    const saved: SavedResume = {
      trackIds: [10, 11, 12],
      index: 1,
      addedEnd: 2,
      positionMs: 9_000,
      radio: { skipped: [10], within: null },
      from: null,
    };
    const resume: ResumeStore = { load: () => saved, saveQueue: () => {}, savePlace: () => {} };
    const harness = await started({ suggest, resume });

    expect(harness.player.state()).toMatchObject({
      status: 'paused',
      radio: { isSource: true },
    });
    expect(harness.player.state().current?.id).toBe(11);
    expect(harness.mpv().sent('loadfile')).toEqual([]);
    expect(asks).toEqual([]);
  });
});
