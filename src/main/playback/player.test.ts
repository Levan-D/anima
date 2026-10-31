/* The whole Player against a fake mpv: everything that takes a real one too long, or too much luck, to make happen. */

import { describe, expect, it, vi } from 'vitest';
import type { PlayerState } from '@shared/domain';
import { makeHarness, makePlayable, type PlayerHarness } from './testFixtures';

const FILE_GONE = 'loading failed';
const DEVICE_FAILED = 'audio output initialization failed';

async function started(options: Parameters<typeof makeHarness>[0] = {}): Promise<PlayerHarness> {
  const harness = makeHarness(options);
  harness.player.start();
  await harness.settle();
  return harness;
}

/** A queue of the five default tracks, with the first one playing and the next one loaded. */
async function playing(options: Parameters<typeof makeHarness>[0] = {}, ids = [1, 2, 3, 4, 5], at = 0) {
  const harness = await started(options);
  harness.player.play(ids, at);
  await harness.settle();
  harness.mpv().startCurrent();
  await harness.settle();
  return harness;
}

/** What mpv holds, as the tracks the paths say. */
function held({ mpv }: PlayerHarness): string[] {
  return mpv().playlist.map(({ path }) => /(\d+)\.flac$/.exec(path)?.[1] ?? path);
}

function currentId({ player }: PlayerHarness): number | null {
  return player.state().current?.id ?? null;
}

function expectConsistent({ player, lastState, mpv }: PlayerHarness): PlayerState {
  const state = player.state();
  // What went out last is what it says now.
  expect(lastState()).toEqual(state);
  expect(state.queueLength).toBe(player.queue().length);
  if (state.queueIndex !== null) expect(player.queue()[state.queueIndex]?.track).toEqual(state.current);
  // mpv never holds more than the current entry and the next one, once it has settled.
  expect(mpv().playlist.length).toBeLessThanOrEqual(2);
  return state;
}

describe('starting', () => {
  it('applies the settings to a new mpv before anything loads', async () => {
    const harness = await started({
      settings: { volume: 37, muted: true, outputMode: 'exclusive', replayGainMode: 'track' },
    });
    const mpv = harness.mpv();
    expect(mpv.properties.get('volume')).toBe(37);
    expect(mpv.properties.get('mute')).toBe(true);
    expect(mpv.properties.get('audio-exclusive')).toBe(true);
    expect(mpv.properties.get('replaygain')).toBe('track');
    expect(mpv.sent('observe_property').map(([, , name]) => name)).toEqual(
      expect.arrayContaining(['time-pos', 'idle-active', 'audio-params', 'audio-out-params']),
    );
    expect(harness.player.state()).toMatchObject({
      status: 'idle',
      current: null,
      volume: 37,
      muted: true,
      outputMode: 'exclusive',
      replayGainMode: 'track',
    });
  });

  it('says ReplayGain off the way mpv calls it', async () => {
    const harness = await started({ settings: { replayGainMode: 'off' } });
    expect(harness.mpv().properties.get('replaygain')).toBe('no');
  });

  it('is unavailable with the path it looked at when the engine is missing, and queueing still works', async () => {
    const harness = await started({ engineExists: () => false });
    const state = harness.player.state();
    expect(state.status).toBe('unavailable');
    expect(state.error).toMatchObject({ code: 'engine_unavailable' });
    expect(state.error?.message).toContain('C:\\fake\\mpv.exe');
    expect(harness.spawned).toEqual([]);

    expect(harness.player.enqueue([1, 2], 'end')).toMatchObject({ ok: true });
    expect(harness.player.queue()).toHaveLength(2);
    expect(harness.player.play([1], 0)).toMatchObject({ ok: false, error: { code: 'engine_unavailable' } });
    expect(harness.player.next()).toMatchObject({ ok: false });
    expect(harness.player.setVolume(50)).toMatchObject({ ok: true });
  });
});

describe('before the engine has started', () => {
  it('holds on to what it was asked, and does it when the engine is up', () => {
    const harness = makeHarness();
    harness.player.play([1, 2], 0);
    expect(harness.player.state()).toMatchObject({ status: 'loading', queueIndex: 0 });
    expect(harness.spawned).toEqual([]);

    harness.player.setVolume(30);
    harness.player.start();
    expect(harness.mpv().properties.get('volume')).toBe(30);
    expect(harness.mpv().sent('loadfile')[0]).toMatchObject(['loadfile', 'D:\\Music\\1.flac', 'replace']);
  });
});

describe('replacing the queue', () => {
  it('loads with replace, then appends the next entry', async () => {
    const harness = await started();
    harness.player.play([1, 2, 3], 0);
    await harness.settle();
    const loads = harness.mpv().sent('loadfile');
    expect(loads.map(([, , mode]) => mode)).toEqual(['replace', 'append']);
    expect(held(harness)).toEqual(['1', '2']);
  });

  it('starts where it was told', async () => {
    const harness = await started();
    harness.player.play([1, 2, 3], 2);
    await harness.settle();
    expect(held(harness)).toEqual(['3']);
    expect(harness.player.state().queueIndex).toBe(2);
  });

  it('goes from loading to playing when the file has loaded', async () => {
    const harness = await started();
    harness.player.play([1, 2], 0);
    expect(harness.player.state().status).toBe('loading');
    expect(harness.player.state().current?.id).toBe(1);
    await harness.settle();
    expect(harness.player.state().status).toBe('loading');
    harness.mpv().startCurrent();
    expect(harness.player.state().status).toBe('playing');
  });

  it('unpauses', async () => {
    const harness = await playing();
    harness.player.pause();
    harness.player.play([3], 0);
    await harness.settle();
    expect(harness.mpv().properties.get('pause')).toBe(false);
    harness.mpv().startCurrent();
    expect(harness.player.state().status).toBe('playing');
  });

  it('gives every load a new id', async () => {
    const harness = await started();
    harness.player.play([1, 2], 0);
    const first = harness.player.state().loadId;
    harness.player.play([3, 4], 0);
    expect(harness.player.state().loadId).toBeGreaterThan(first);
  });

  it('refuses tracks that are not in the library, and leaves things as they were', async () => {
    const harness = await playing();
    const before = harness.player.state();
    expect(harness.player.play([999], 0)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(harness.player.state()).toEqual(before);
  });

  it('follows the track it was told to start from when an earlier one has gone from the library', async () => {
    const harness = await started();
    harness.player.play([999, 1, 2], 2);
    expect(harness.player.state().current?.id).toBe(2);
    expect(harness.player.state().queueIndex).toBe(1);
  });

  it('keeps the same track queued twice apart', async () => {
    const harness = await started();
    harness.player.play([1, 1], 0);
    await harness.settle();
    const { mpv } = harness;
    mpv().startCurrent();
    await harness.settle();
    const [first, second] = harness.player.queue();
    expect(first?.queueId).not.toBe(second?.queueId);

    mpv().finishCurrent();
    await harness.settle();
    expect(harness.player.state().queueIndex).toBe(1);
  });
});

describe('moving through the queue', () => {
  it('uses playlist-next when the next entry is loaded', async () => {
    const harness = await playing();
    const loadsBefore = harness.mpv().sent('loadfile').length;
    harness.player.next();
    await harness.settle();
    const { mpv } = harness;
    expect(mpv().sent('playlist-next')).toHaveLength(1);
    // Only the entry after it, to top up.
    expect(
      mpv()
        .sent('loadfile')
        .slice(loadsBefore)
        .map(([, , mode]) => mode),
    ).toEqual(['append']);
    expect(currentId(harness)).toBe(2);
    expect(harness.player.state().status).toBe('loading');
    mpv().startCurrent();
    expect(harness.player.state().status).toBe('playing');
    await harness.settle();
    expect(held(harness)).toEqual(['2', '3']);
  });

  it('jumps with replace, then append', async () => {
    const harness = await playing();
    harness.player.playQueueIndex(3);
    await harness.settle();
    expect(
      harness
        .mpv()
        .sent('loadfile')
        .slice(-2)
        .map(([, , mode]) => mode),
    ).toEqual(['replace', 'append']);
    expect(held(harness)).toEqual(['4', '5']);
    expect(harness.mpv().sent('playlist-next')).toEqual([]);
  });

  it('says so when there is nothing at the place it was asked to jump to', async () => {
    const harness = await playing();
    expect(harness.player.playQueueIndex(99)).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('restarts the current track when asked to jump to it', async () => {
    const harness = await playing();
    harness.player.playQueueIndex(0);
    await harness.settle();
    expect(harness.mpv().sent('seek').at(-1)).toEqual(['seek', 0, 'absolute']);
    expect(harness.mpv().sent('loadfile')).toHaveLength(2);
  });

  it('goes back when not far in', async () => {
    const harness = await playing();
    harness.player.next();
    await harness.settle();
    harness.mpv().startCurrent();
    await harness.settle();
    harness.mpv().timePos(2.9);

    harness.player.previous();
    expect(currentId(harness)).toBe(1);
    await harness.settle();
    expect(harness.mpv().sent('loadfile').at(-2)).toMatchObject(['loadfile', 'D:\\Music\\1.flac', 'replace']);
  });

  it('restarts when more than three seconds in', async () => {
    const harness = await playing();
    harness.player.next();
    await harness.settle();
    harness.mpv().startCurrent();
    await harness.settle();
    harness.mpv().timePos(3.1);

    harness.player.previous();
    expect(currentId(harness)).toBe(2);
    await harness.settle();
    expect(harness.mpv().sent('seek').at(-1)).toEqual(['seek', 0, 'absolute']);
  });

  it('restarts at the first track, however far in', async () => {
    const harness = await playing();
    harness.mpv().timePos(1);
    harness.player.previous();
    expect(currentId(harness)).toBe(1);
    await harness.settle();
    expect(harness.mpv().sent('seek').at(-1)).toEqual(['seek', 0, 'absolute']);
  });

  it('stays paused across next and previous', async () => {
    const harness = await playing();
    harness.player.pause();
    harness.player.next();
    await harness.settle();
    harness.mpv().startCurrent();
    expect(harness.player.state().status).toBe('paused');
    expect(harness.mpv().properties.get('pause')).toBe(true);
  });

  it('ends the queue when asked for next at the last track, keeping it', async () => {
    const harness = await playing({}, [1, 2], 1);
    harness.player.next();
    await harness.settle();
    expect(harness.player.state()).toMatchObject({ status: 'ended', queueIndex: 1 });
    expect(currentId(harness)).toBe(2);
    expect(harness.mpv().playlist).toEqual([]);
  });
});

describe('a transition mpv makes by itself', () => {
  it('moves the queue on start-file, and tops up the next entry', async () => {
    const harness = await playing();
    const { mpv } = harness;
    const before = harness.player.state().loadId;

    const finished = mpv().entry(0);
    mpv().pos = 1;
    mpv().endFile(finished.id, 'eof');
    expect(harness.player.state().queueIndex).toBe(0);
    mpv().startFile(mpv().entry(1).id);
    expect(harness.player.state().queueIndex).toBe(1);
    expect(harness.player.state().loadId).toBeGreaterThan(before);

    await harness.settle();
    expect(held(harness)).toEqual(['2', '3']);
    expect(mpv().sent('playlist-remove').at(-1)).toEqual(['playlist-remove', 0]);
    expect(mpv().sent('loadfile').at(-1)).toMatchObject(['loadfile', 'D:\\Music\\3.flac', 'append']);
  });

  it('stays playing through it, with no flash of loading', async () => {
    const harness = await playing();
    harness.states.length = 0;
    harness.mpv().finishCurrent();
    await harness.settle();
    expect(harness.states.map(({ status }) => status)).not.toContain('loading');
    expect(harness.player.state().status).toBe('playing');
  });

  it('does nothing to the queue while it happens that it does not have to', async () => {
    const harness = await playing();
    const version = harness.player.state().queueVersion;
    harness.mpv().finishCurrent();
    await harness.settle();
    expect(harness.player.state().queueVersion).toBe(version);
  });

  it('runs through a whole queue, holding two at most', async () => {
    const harness = await playing();
    for (const id of [2, 3, 4, 5]) {
      harness.mpv().finishCurrent();
      await harness.settle();
      expect(currentId(harness)).toBe(id);
      expectConsistent(harness);
    }
    expect(harness.player.state().status).toBe('playing');

    harness.mpv().finishCurrent();
    await harness.settle();
    expect(harness.player.state()).toMatchObject({ status: 'ended', queueIndex: 4 });
    expect(currentId(harness)).toBe(5);
  });

  it('starts from the top on play once it has ended', async () => {
    const harness = await playing({}, [1, 2], 1);
    harness.mpv().finishCurrent();
    await harness.settle();
    expect(harness.player.state().status).toBe('ended');

    harness.player.resume();
    expect(harness.player.state()).toMatchObject({ status: 'loading', queueIndex: 0 });
    await harness.settle();
    expect(held(harness)).toEqual(['1', '2']);
    harness.mpv().startCurrent();
    expect(harness.player.state().status).toBe('playing');
  });

  it('starts from the top on toggle too', async () => {
    const harness = await playing({}, [1, 2], 1);
    harness.mpv().finishCurrent();
    await harness.settle();
    harness.player.toggle();
    expect(harness.player.state().queueIndex).toBe(0);
  });

  it('gets a new entry in, if mpv went idle before the next one arrived', async () => {
    const harness = await playing();
    const { mpv } = harness;
    const finished = mpv().entry(0);
    const next = mpv().entry(1);
    // mpv settled on having nothing next a moment before it got the entry, so it goes idle with it in the list.
    mpv().pos = -1;
    mpv().endFile(finished.id, 'eof');
    mpv().property('idle-active', true);
    await harness.settle();

    expect(currentId(harness)).toBe(2);
    expect(mpv().sent('loadfile').at(-2)).toMatchObject(['loadfile', 'D:\\Music\\2.flac', 'replace']);
    expect(mpv().playlist[0]?.id).not.toBe(next.id);
    mpv().startCurrent();
    expect(harness.player.state().status).toBe('playing');
  });
});

describe('stale and out-of-order events', () => {
  it('ignores position between a load and its file-loaded', async () => {
    const harness = await started();
    harness.player.play([1, 2], 0);
    await harness.settle();
    const { mpv } = harness;
    mpv().timePos(50);
    mpv().startFile(mpv().entry(0).id);
    mpv().timePos(60);
    expect(harness.positions).toEqual([]);
    mpv().fileLoaded();
    mpv().timePos(0.1);
    expect(harness.positions).toEqual([{ loadId: harness.player.state().loadId, positionMs: 100 }]);
  });

  it('drops everything about an entry it replaced', async () => {
    const harness = await playing();
    const { mpv } = harness;
    const old = mpv().entry(0);
    harness.player.playQueueIndex(3);
    await harness.settle();
    const loadId = harness.player.state().loadId;
    harness.states.length = 0;
    harness.positions.length = 0;

    // Everything the old file still had to say, on its way out.
    mpv().timePos(150);
    mpv().endFile(old.id, 'stop');
    mpv().fileLoaded();
    mpv().endFile(old.id, 'eof');
    await harness.settle();
    expect(harness.positions).toEqual([]);
    expect(harness.player.state()).toMatchObject({ loadId, status: 'loading', queueIndex: 3 });

    mpv().startCurrent();
    expect(harness.player.state()).toMatchObject({ loadId, status: 'playing', queueIndex: 3 });
  });

  it('does not take a file-loaded for one that was replaced as the new one’s', async () => {
    const harness = await started();
    harness.player.play([1], 0);
    await harness.settle();
    const { mpv } = harness;
    const first = mpv().entry(0);
    mpv().startFile(first.id);
    harness.player.play([2], 0);
    await harness.settle();

    // The first file finishes opening after the Player has moved on.
    mpv().fileLoaded();
    expect(harness.player.state().status).toBe('loading');
    mpv().endFile(first.id, 'stop');
    mpv().startCurrent();
    expect(harness.player.state().status).toBe('playing');
  });

  it('understands a start-file that overtakes the reply to its loadfile', async () => {
    const harness = await started();
    const { mpv } = harness;
    mpv().holdingReplies = true;
    harness.player.play([1, 2], 0);
    await harness.settle();
    const entry = mpv().entry(0);

    // The event gets here first, along with what follows it, and the reply comes after.
    mpv().startFile(entry.id);
    mpv().fileLoaded();
    mpv().timePos(0.5);
    expect(harness.player.state().status).toBe('loading');

    mpv().holdingReplies = false;
    await harness.settle();
    expect(harness.player.state().status).toBe('playing');
    expect(harness.player.position().positionMs).toBe(500);
    expect(held(harness)).toEqual(['1', '2']);
  });

  it('understands a start-file of a next entry that overtakes its reply', async () => {
    const harness = await started();
    harness.player.play([1, 2, 3], 0);
    const { mpv } = harness;
    mpv().flushReplies();
    await new Promise((resolve) => setImmediate(resolve));
    // Now the append has gone out, and its answer hasn't come back.
    mpv().holdingReplies = true;
    await new Promise((resolve) => setImmediate(resolve));
    const first = mpv().entry(0);
    const second = mpv().entry(1);
    mpv().startFile(first.id);
    mpv().fileLoaded();
    mpv().pos = 1;
    mpv().endFile(first.id, 'eof');
    mpv().startFile(second.id);
    mpv().fileLoaded();

    mpv().holdingReplies = false;
    await harness.settle();
    expect(currentId(harness)).toBe(2);
    expect(harness.player.state().status).toBe('playing');
    expect(held(harness)).toEqual(['2', '3']);
  });

  it('ignores a start-file it knows nothing about', async () => {
    const harness = await playing();
    const before = harness.player.state();
    harness.mpv().startFile(999);
    harness.mpv().endFile(999, 'eof');
    await harness.settle();
    expect(harness.player.state()).toEqual(before);
  });
});

describe('a transition arriving during a command', () => {
  it('still plays what was inserted next, when mpv moved on just as the old next was being removed', async () => {
    const harness = await playing();
    const { mpv } = harness;
    const a = mpv().entry(0);
    const b = mpv().entry(1);

    // The insert goes out, and the transition is already on the wire when it gets there.
    mpv().holdingReplies = true;
    harness.player.enqueue([5], 'next');
    expect(mpv().sent('playlist-remove')).toEqual([['playlist-remove', 1]]);
    mpv().endFile(a.id, 'eof');
    mpv().startFile(b.id);
    mpv().endFile(b.id, 'stop');

    mpv().holdingReplies = false;
    await harness.settle();

    // The queue is 1, 5, 2, … and it was 5's turn.
    expect(currentId(harness)).toBe(5);
    expect(harness.player.state().queueIndex).toBe(1);
    mpv().startCurrent();
    await harness.settle();
    expect(harness.player.state().status).toBe('playing');
    expect(held(harness)).toEqual(['5', '2']);
    expectConsistent(harness);
  });

  it('lands on the right track when next crosses a transition that was already happening', async () => {
    const harness = await playing();
    const { mpv } = harness;
    const a = mpv().entry(0);
    const b = mpv().entry(1);
    const replaces = () =>
      mpv()
        .sent('loadfile')
        .filter(([, , mode]) => mode === 'replace').length;
    const before = replaces();

    // mpv got to the next entry by itself just before the command, so there's nothing after it to go to.
    mpv().refusing.add('playlist-next');
    mpv().holdingReplies = true;
    harness.player.next();
    mpv().pos = 1;
    mpv().endFile(a.id, 'eof');
    mpv().startFile(b.id);
    mpv().fileLoaded();
    mpv().holdingReplies = false;
    await harness.settle();

    expect(currentId(harness)).toBe(2);
    expect(harness.player.state()).toMatchObject({ queueIndex: 1, status: 'playing' });
    expect(replaces()).toBe(before);
    expect(held(harness)).toEqual(['2', '3']);
    expectConsistent(harness);
  });

  it('loads the track when mpv refuses next and never says it got there', async () => {
    const harness = await playing();
    const { mpv } = harness;
    mpv().refusing.add('playlist-next');
    harness.player.next();
    await harness.settle();
    expect(mpv().sent('loadfile').at(-2)).toMatchObject(['loadfile', 'D:\\Music\\2.flac', 'replace']);
    expect(held(harness)).toEqual(['2', '3']);
  });

  it('follows a command given between an entry ending and the next one starting', async () => {
    const harness = await playing();
    const { mpv } = harness;
    const a = mpv().entry(0);
    const b = mpv().entry(1);

    mpv().endFile(a.id, 'eof');
    // Next, twice: the Player's on 3 now, whatever mpv does.
    harness.player.next();
    harness.player.next();
    mpv().pos = 1;
    mpv().startFile(b.id);
    await harness.settle();

    expect(currentId(harness)).toBe(3);
    expect(harness.player.state().queueIndex).toBe(2);
    expect(mpv().sent('loadfile').at(-2)).toMatchObject(['loadfile', 'D:\\Music\\3.flac', 'replace']);
    mpv().startCurrent();
    await harness.settle();
    expect(harness.player.state().status).toBe('playing');
    expect(held(harness)).toEqual(['3', '4']);
  });

  it('does not let the track it was removing start playing, when the end of the queue got there first', async () => {
    const harness = await playing({}, [1, 2]);
    const { mpv } = harness;
    const a = mpv().entry(0);
    const b = mpv().entry(1);
    const [, second] = harness.player.queue();

    mpv().holdingReplies = true;
    harness.player.removeFromQueue([second?.queueId ?? -1]);
    mpv().endFile(a.id, 'eof');
    mpv().startFile(b.id);
    mpv().holdingReplies = false;
    await harness.settle();

    expect(harness.player.state()).toMatchObject({ status: 'ended', queueIndex: 0 });
    expect(currentId(harness)).toBe(1);
    expect(mpv().sent('stop')).toHaveLength(1);
  });

  it('goes back to where it was if mpv stops the current entry on its own', async () => {
    const harness = await playing();
    const { mpv } = harness;
    mpv().timePos(30);
    mpv().endFile(mpv().entry(0).id, 'stop');
    await harness.settle();
    expect(mpv().sent('loadfile').at(-2)).toEqual(['loadfile', 'D:\\Music\\1.flac', 'replace', -1, 'start=30.000']);
    expect(currentId(harness)).toBe(1);
  });

  it('reloads from where it was when a removal is refused, since it no longer knows what mpv holds', async () => {
    const harness = await playing();
    const { mpv } = harness;
    mpv().timePos(30);
    mpv().refusing.add('playlist-remove');
    harness.player.enqueue([5], 'next');
    await harness.settle();
    mpv().refusing.clear();
    await harness.settle();
    expect(mpv().sent('loadfile').at(-2)).toEqual(['loadfile', 'D:\\Music\\1.flac', 'replace', -1, 'start=30.000']);
    expect(held(harness)).toEqual(['1', '5']);
  });
});

describe('around the current item', () => {
  it('re-syncs the next entry when something is inserted, without touching what is playing', async () => {
    const harness = await playing();
    const { mpv } = harness;
    const playingEntry = mpv().entry(0);
    harness.player.enqueue([5], 'next');
    await harness.settle();
    expect(mpv().entry(0)).toEqual(playingEntry);
    expect(held(harness)).toEqual(['1', '5']);
    expect(
      mpv()
        .sent('loadfile')
        .filter(([, , mode]) => mode === 'replace'),
    ).toHaveLength(1);
    expect(harness.player.state().status).toBe('playing');
  });

  it('re-syncs the next entry when it is removed', async () => {
    const harness = await playing();
    const [, second] = harness.player.queue();
    harness.player.removeFromQueue([second?.queueId ?? -1]);
    await harness.settle();
    expect(held(harness)).toEqual(['1', '3']);
    expect(
      harness
        .mpv()
        .sent('loadfile')
        .filter(([, , mode]) => mode === 'replace'),
    ).toHaveLength(1);
  });

  it('re-syncs the next entry when it moves', async () => {
    const harness = await playing();
    const queue = harness.player.queue();
    harness.player.moveInQueue(queue[3]?.queueId ?? -1, 1);
    await harness.settle();
    expect(held(harness)).toEqual(['1', '4']);
  });

  it('touches nothing when what changes is further on', async () => {
    const harness = await playing();
    const commands = harness.mpv().commands.length;
    const queue = harness.player.queue();
    harness.player.moveInQueue(queue[4]?.queueId ?? -1, 3);
    harness.player.enqueue([1], 'end');
    await harness.settle();
    expect(harness.mpv().commands).toHaveLength(commands);
    expect(harness.player.state().queueLength).toBe(6);
  });

  it('removes the next entry when nothing comes after the current one any more', async () => {
    const harness = await playing({}, [1, 2]);
    const [, second] = harness.player.queue();
    harness.player.removeFromQueue([second?.queueId ?? -1]);
    await harness.settle();
    expect(held(harness)).toEqual(['1']);
    expect(harness.player.state().status).toBe('playing');
  });

  it('adds the next entry when one arrives', async () => {
    const harness = await playing({}, [1]);
    expect(held(harness)).toEqual(['1']);
    harness.player.enqueue([2], 'end');
    await harness.settle();
    expect(held(harness)).toEqual(['1', '2']);
  });

  it('moves on when the current item is removed, gaplessly when the next is loaded', async () => {
    const harness = await playing();
    const [first] = harness.player.queue();
    harness.player.removeFromQueue([first?.queueId ?? -1]);
    await harness.settle();
    expect(currentId(harness)).toBe(2);
    expect(harness.player.state().queueIndex).toBe(0);
    expect(harness.mpv().sent('playlist-next')).toHaveLength(1);
  });

  it('stops when the current item is removed and nothing comes after it', async () => {
    const harness = await playing({}, [1, 2], 1);
    const [, second] = harness.player.queue();
    harness.player.removeFromQueue([second?.queueId ?? -1]);
    await harness.settle();
    expect(harness.player.state()).toMatchObject({ status: 'idle', current: null, queueIndex: null, queueLength: 1 });
    expect(harness.mpv().playlist).toEqual([]);

    harness.player.resume();
    expect(harness.player.state()).toMatchObject({ queueIndex: 0, status: 'loading' });
  });

  it('clears everything and stops', async () => {
    const harness = await playing();
    harness.player.clearQueue();
    await harness.settle();
    expect(harness.player.state()).toMatchObject({ status: 'idle', current: null, queueLength: 0, queueIndex: null });
    expect(harness.mpv().playlist).toEqual([]);
  });

  it('adds to the queue without starting anything when nothing is playing', async () => {
    const harness = await started();
    harness.player.enqueue([1, 2], 'end');
    await harness.settle();
    expect(harness.player.state()).toMatchObject({ status: 'idle', queueLength: 2, queueIndex: null });
    expect(harness.mpv().sent('loadfile')).toEqual([]);

    harness.player.toggle();
    expect(harness.player.state()).toMatchObject({ status: 'loading', queueIndex: 0 });
  });

  it('changes the version only when the contents do', async () => {
    const harness = await playing();
    const version = () => harness.player.state().queueVersion;
    const first = version();
    harness.player.next();
    expect(version()).toBe(first);
    harness.player.enqueue([1], 'end');
    expect(version()).toBe(first + 1);
    harness.player.moveInQueue(harness.player.queue()[0]?.queueId ?? -1, 1);
    expect(version()).toBe(first + 2);
    harness.player.removeFromQueue([harness.player.queue()[0]?.queueId ?? -1]);
    expect(version()).toBe(first + 3);
    harness.player.clearQueue();
    expect(version()).toBe(first + 4);
    await harness.settle();
  });

  it('keeps the contents out of the state, and out of what the queue command sends beyond its own shape', async () => {
    const harness = await playing();
    expect(harness.player.state()).not.toHaveProperty('queue');
    expect(Object.keys(harness.player.queue()[0] ?? {}).sort()).toEqual(['queueId', 'track']);
  });
});

describe('position', () => {
  it('relays about five a second from mpv’s thirteen', async () => {
    const harness = await playing();
    harness.positions.length = 0;
    for (let tick = 1; tick <= 130; tick++) {
      harness.advance(77);
      harness.mpv().timePos(tick * 0.077);
    }
    const perSecond = harness.positions.length / ((130 * 77) / 1000);
    expect(perSecond).toBeGreaterThan(4.5);
    expect(perSecond).toBeLessThan(5.5);
  });

  it('sends no state for it', async () => {
    const harness = await playing();
    harness.states.length = 0;
    for (let tick = 1; tick <= 50; tick++) {
      harness.advance(77);
      harness.mpv().timePos(tick * 0.077);
    }
    expect(harness.states).toEqual([]);
  });

  it('goes out once on pause, and not again while paused', async () => {
    const harness = await playing();
    harness.advance(1000);
    harness.mpv().timePos(5);
    harness.positions.length = 0;
    harness.mpv().timePos(5.05);
    harness.player.pause();
    expect(harness.positions).toEqual([{ loadId: harness.player.state().loadId, positionMs: 5050 }]);
    harness.mpv().timePos(4.9);
    harness.advance(1000);
    harness.mpv().timePos(4.9);
    expect(harness.positions).toHaveLength(1);
  });

  it('goes out once on seek, right away, and mpv’s ticks only count again after it answers', async () => {
    const harness = await playing();
    harness.positions.length = 0;
    const { mpv } = harness;
    mpv().holdingReplies = true;
    harness.player.seek(60_000);
    expect(harness.positions).toEqual([{ loadId: harness.player.state().loadId, positionMs: 60_000 }]);

    harness.advance(1000);
    mpv().timePos(5);
    expect(harness.positions).toHaveLength(1);
    mpv().holdingReplies = false;
    await harness.settle();

    harness.advance(1000);
    mpv().timePos(60.1);
    expect(harness.positions.at(-1)?.positionMs).toBe(60_100);
  });

  it('holds a seek made while paused, whatever mpv reports after it', async () => {
    const harness = await playing();
    harness.player.pause();
    harness.player.seek(7000);
    await harness.settle();
    harness.advance(1000);
    // What mpv really does here: the target, then a little before it, until it resumes.
    harness.mpv().timePos(7);
    harness.mpv().timePos(6.813);
    expect(harness.player.position().positionMs).toBe(7000);
    harness.player.resume();
    harness.advance(1000);
    harness.mpv().timePos(7.05);
    expect(harness.player.position().positionMs).toBe(7050);
  });

  it('carries the load it belongs to', async () => {
    const harness = await playing();
    const first = harness.player.state().loadId;
    harness.advance(1000);
    harness.mpv().timePos(1);
    expect(harness.positions.at(-1)?.loadId).toBe(first);

    harness.mpv().finishCurrent();
    await harness.settle();
    harness.advance(1000);
    harness.mpv().timePos(1);
    expect(harness.positions.at(-1)?.loadId).toBeGreaterThan(first);
  });

  it('never goes below zero', async () => {
    const harness = await playing();
    harness.advance(1000);
    harness.mpv().timePos(-0.1);
    expect(harness.player.position().positionMs).toBe(0);
  });

  it('can be asked for, for a window that opens while paused', async () => {
    const harness = await playing();
    harness.mpv().timePos(12);
    harness.player.pause();
    expect(harness.player.position()).toEqual({ loadId: harness.player.state().loadId, positionMs: 12_000 });
  });
});

describe('seek', () => {
  it('seeks to where it was told', async () => {
    const harness = await playing();
    harness.player.seek(60_000);
    await harness.settle();
    expect(harness.mpv().sent('seek').at(-1)).toEqual(['seek', 60, 'absolute']);
  });

  it('clamps past the end to half a second before it', async () => {
    const harness = await playing();
    harness.player.seek(999_999_999);
    await harness.settle();
    expect(harness.mpv().sent('seek').at(-1)).toEqual(['seek', 199.5, 'absolute']);
    expect(harness.player.position().positionMs).toBe(199_500);
  });

  it('clamps using what mpv says the length is, once it knows', async () => {
    const harness = await started();
    harness.player.play([1], 0);
    await harness.settle();
    harness.mpv().answers.set('duration', 90.5);
    harness.mpv().startCurrent();
    await harness.settle();
    expect(harness.player.state().durationMs).toBe(90_500);
    harness.player.seek(500_000);
    await harness.settle();
    expect(harness.mpv().sent('seek').at(-1)).toEqual(['seek', 90, 'absolute']);
  });

  it('goes after the file has loaded if it was asked for during the load', async () => {
    const harness = await started();
    harness.player.play([1, 2], 0);
    harness.player.seek(30_000);
    await harness.settle();
    const { mpv } = harness;
    expect(mpv().sent('seek')).toEqual([]);
    mpv().startFile(mpv().entry(0).id);
    expect(mpv().sent('seek')).toEqual([]);
    mpv().fileLoaded();
    await harness.settle();
    expect(mpv().sent('seek')).toEqual([['seek', 30, 'absolute']]);
    expect(harness.player.position().positionMs).toBe(30_000);
  });

  it('forgets a seek asked for during a load, if the track changes before it can happen', async () => {
    const harness = await started();
    harness.player.play([1, 2, 3], 0);
    harness.player.seek(30_000);
    harness.player.next();
    await harness.settle();
    harness.mpv().startCurrent();
    await harness.settle();
    expect(harness.mpv().sent('seek')).toEqual([]);
    expect(harness.player.position().positionMs).toBe(0);
  });

  it('sends only where a drag ended up', async () => {
    const harness = await playing();
    const { mpv } = harness;
    mpv().holdingReplies = true;
    for (const target of [10, 20, 30, 40, 50]) harness.player.seek(target * 1000);
    mpv().holdingReplies = false;
    await harness.settle();
    expect(
      mpv()
        .sent('seek')
        .map(([, seconds]) => seconds),
    ).toEqual([10, 50]);
  });

  it('opens the last track again at that place, once it has ended', async () => {
    const harness = await playing({}, [1]);
    harness.mpv().finishCurrent();
    await harness.settle();
    harness.player.seek(30_000);
    await harness.settle();
    expect(harness.mpv().sent('loadfile').at(-1)).toEqual([
      'loadfile',
      'D:\\Music\\1.flac',
      'replace',
      -1,
      'start=30.000',
    ]);
  });

  it('does nothing with nothing current', async () => {
    const harness = await started();
    expect(harness.player.seek(1000)).toMatchObject({ ok: true });
    expect(harness.mpv().sent('seek')).toEqual([]);
  });
});

describe('settings', () => {
  it('saves and applies volume, mute, output mode and ReplayGain mode', async () => {
    const harness = await started();
    const { player, settings, mpv } = harness;
    player.setVolume(40);
    player.setMuted(true);
    player.setOutputMode('exclusive');
    player.setReplayGainMode('off');
    await harness.settle();

    expect(settings.get()).toMatchObject({ volume: 40, muted: true, outputMode: 'exclusive', replayGainMode: 'off' });
    expect(mpv().properties.get('volume')).toBe(40);
    expect(mpv().properties.get('mute')).toBe(true);
    expect(mpv().properties.get('audio-exclusive')).toBe(true);
    expect(mpv().properties.get('replaygain')).toBe('no');
    expect(player.state()).toMatchObject({ volume: 40, muted: true, outputMode: 'exclusive', replayGainMode: 'off' });
    expect(harness.lastState()).toMatchObject({ volume: 40, muted: true });
  });

  it('touches exclusive only by the one property, and leaves the rest alone', async () => {
    const harness = await playing();
    const { mpv } = harness;
    const before = mpv().commands.length;
    harness.player.setOutputMode('exclusive');
    await harness.settle();
    expect(mpv().commands.slice(before)).toEqual([['set_property', 'audio-exclusive', true]]);
    expect(harness.player.state()).toMatchObject({ status: 'playing', outputMode: 'exclusive' });
  });

  it('does not send a mode it is already in', async () => {
    const harness = await started();
    const before = harness.mpv().commands.length;
    harness.player.setOutputMode('shared');
    expect(harness.mpv().commands).toHaveLength(before);
  });

  it('saves what is set while the engine is unavailable, for when it comes back', async () => {
    const harness = await started({ engineExists: () => false });
    harness.player.setVolume(12);
    expect(harness.settings.get().volume).toBe(12);
    expect(harness.player.state().volume).toBe(12);
  });
});

describe('the signal path', () => {
  const CD = { samplerate: 44_100, 'channel-count': 2, channels: 'stereo', format: 's16' };

  it('follows what mpv says it decoded and sends out', async () => {
    const harness = await playing({ settings: { outputMode: 'exclusive' } });
    const { mpv, player } = harness;
    mpv().property('audio-params', CD);
    mpv().property('audio-out-params', CD);
    expect(player.state().signal).toEqual({
      decoded: { sampleRate: 44_100, format: 's16', channels: 2 },
      output: { sampleRate: 44_100, format: 's16', channels: 2 },
      isBitPerfect: true,
      alterations: [],
    });

    player.setOutputMode('shared');
    mpv().property('audio-out-params', { ...CD, samplerate: 48_000, format: 'float' });
    expect(player.state().signal.alterations).toEqual([
      'Windows is mixing',
      'Resampled to 48 kHz',
      'Converted to 32-bit float',
    ]);
  });

  it('counts the ReplayGain the file really has', async () => {
    const harness = await started({ settings: { outputMode: 'exclusive', replayGainMode: 'album' } });
    harness.player.play([1, 2], 0);
    await harness.settle();
    const { mpv, player } = harness;
    mpv().answers.set('current-tracks/audio', { 'replaygain-album-gain': -6.21, 'replaygain-album-peak': 0.9 });
    mpv().startCurrent();
    await harness.settle();
    mpv().property('audio-params', CD);
    mpv().property('audio-out-params', CD);
    expect(player.state().signal.alterations).toEqual(['ReplayGain is changing the level']);

    player.setReplayGainMode('off');
    expect(player.state().signal.isBitPerfect).toBe(true);
  });

  it('calls a file with no tags, or exactly 0 dB, untouched', async () => {
    const harness = await started({ settings: { outputMode: 'exclusive', replayGainMode: 'album' } });
    harness.player.play([1, 2], 0);
    await harness.settle();
    const { mpv, player } = harness;
    mpv().answers.set('current-tracks/audio', { 'replaygain-album-gain': 0, 'replaygain-album-peak': 1 });
    mpv().startCurrent();
    await harness.settle();
    mpv().property('audio-params', CD);
    mpv().property('audio-out-params', CD);
    expect(player.state().signal.isBitPerfect).toBe(true);
  });

  it('keeps showing through the moment between two files when the params go empty', async () => {
    const harness = await playing({ settings: { outputMode: 'exclusive' } });
    const { mpv, player } = harness;
    mpv().property('audio-params', CD);
    mpv().property('audio-out-params', CD);
    harness.states.length = 0;
    mpv().property('audio-params', null);
    expect(player.state().signal.decoded).not.toBeNull();
    expect(harness.states).toEqual([]);
  });

  it('clears when nothing is playing', async () => {
    const harness = await playing();
    const { mpv, player } = harness;
    mpv().property('audio-params', CD);
    mpv().property('audio-out-params', CD);
    mpv().property('idle-active', true);
    expect(player.state().signal).toEqual({ decoded: null, output: null, isBitPerfect: false, alterations: [] });
  });
});

describe('a file that fails to load', () => {
  it('marks it missing, sends a notice that can reveal it, and skips', async () => {
    const harness = await playing();
    const { mpv, player, library, notices } = harness;
    mpv().finishCurrent();
    await harness.settle();
    expect(currentId(harness)).toBe(2);

    const failing = mpv().entry(0);
    mpv().pos = 1;
    mpv().endFile(failing.id, 'error', FILE_GONE);
    mpv().startCurrent();
    await harness.settle();

    expect(library.missing).toEqual([2]);
    expect(notices).toEqual([
      {
        level: 'warning',
        message: expect.stringContaining('Track 2') as string,
        action: { kind: 'reveal-track', label: 'Reveal', trackId: 2 },
      },
    ]);
    expect(currentId(harness)).toBe(3);
    expect(player.state().status).toBe('playing');
    expect(player.queue()[1]?.track.isMissing).toBe(true);
    expect(player.queue()[0]?.track.isMissing).toBe(false);
  });

  it('loads what is next itself, when mpv has nothing to go on to', async () => {
    const harness = await started();
    harness.player.play([1, 2], 0);
    const { mpv } = harness;
    mpv().flushReplies();
    await new Promise((resolve) => setImmediate(resolve));
    mpv().holdingReplies = true;
    const failing = mpv().entry(0);
    mpv().startFile(failing.id);
    // It fails with the append still on its way, so as far as mpv knows there's nothing after it.
    mpv().pos = -1;
    mpv().endFile(failing.id, 'error', FILE_GONE);
    mpv().property('idle-active', true);
    mpv().holdingReplies = false;
    await harness.settle();

    expect(currentId(harness)).toBe(2);
    expect(mpv().sent('loadfile').at(-1)).toMatchObject(['loadfile', 'D:\\Music\\2.flac', 'replace']);
    mpv().startCurrent();
    expect(harness.player.state().status).toBe('playing');
  });

  it('stops with an error once it has tried the whole queue', async () => {
    const harness = await started();
    harness.player.play([1, 2, 3], 0);
    await harness.settle();
    const { mpv, notices, library } = harness;

    for (const failingAt of [0, 1, 2]) {
      const failing = mpv().entry(mpv().pos);
      mpv().startFile(failing.id);
      mpv().pos = mpv().playlist[mpv().pos + 1] ? mpv().pos + 1 : -1;
      mpv().endFile(failing.id, 'error', FILE_GONE);
      if (failingAt < 2) {
        await harness.settle();
      }
    }
    await harness.settle();

    expect(harness.player.state().status).toBe('error');
    expect(harness.player.state().error).toMatchObject({ code: 'file_missing' });
    expect(notices).toHaveLength(3);
    expect(library.missing).toEqual([1, 2, 3]);
    expect(mpv().playlist).toEqual([]);
  });

  it('goes round to the top when it started partway and nothing has played yet', async () => {
    const harness = await started();
    harness.player.play([1, 2], 1);
    await harness.settle();
    const { mpv } = harness;
    const failing = mpv().entry(0);
    mpv().startFile(failing.id);
    mpv().pos = -1;
    mpv().endFile(failing.id, 'error', FILE_GONE);
    await harness.settle();
    expect(currentId(harness)).toBe(1);
    mpv().startCurrent();
    expect(harness.player.state().status).toBe('playing');
  });

  it('ends rather than going round, when something did play and the last track is what failed', async () => {
    const harness = await playing({}, [1, 2]);
    const { mpv } = harness;
    harness.advance(1000);
    mpv().timePos(3);
    mpv().finishCurrent();
    await harness.settle();

    const failing = mpv().entry(0);
    mpv().pos = -1;
    mpv().endFile(failing.id, 'error', FILE_GONE);
    await harness.settle();
    expect(harness.player.state().status).toBe('ended');
    expect(
      mpv()
        .sent('loadfile')
        .filter(([, , mode]) => mode === 'replace'),
    ).toHaveLength(1);
  });

  it('counts a track that plays as starting the count over', async () => {
    const harness = await started();
    harness.player.play([1, 2, 3], 0);
    await harness.settle();
    const { mpv } = harness;

    let failing = mpv().entry(0);
    mpv().startFile(failing.id);
    mpv().pos = 1;
    mpv().endFile(failing.id, 'error', FILE_GONE);
    mpv().startCurrent();
    await harness.settle();
    harness.advance(1000);
    mpv().timePos(5);
    mpv().finishCurrent();
    await harness.settle();

    failing = mpv().entry(0);
    mpv().pos = -1;
    mpv().endFile(failing.id, 'error', FILE_GONE);
    await harness.settle();
    // The third failed, one short of the whole queue had it not been for the second playing, and there's no more.
    expect(harness.player.state().status).toBe('ended');
  });

  it('skips without marking it missing when the file is there but unreadable', async () => {
    const harness = await playing();
    const { mpv, library, notices } = harness;
    const failing = mpv().entry(0);
    mpv().pos = 1;
    mpv().endFile(failing.id, 'error', 'unrecognized file format');
    mpv().startCurrent();
    await harness.settle();
    expect(library.missing).toEqual([]);
    expect(notices[0]?.action).toEqual({ kind: 'reveal-track', label: 'Reveal', trackId: 1 });
    expect(currentId(harness)).toBe(2);
  });

  it('skips with a notice when the library no longer knows the track, trying nothing', async () => {
    const harness = await started({ pathOf: (id) => (id === 1 ? null : `D:\\Music\\${id}.flac`) });
    harness.player.play([1, 2, 3], 0);
    await harness.settle();
    expect(harness.notices).toHaveLength(1);
    expect(harness.notices[0]).toMatchObject({ level: 'warning', action: null });
    expect(currentId(harness)).toBe(2);
    expect(held(harness)).toEqual(['2', '3']);
  });

  it('does not hold a next entry the library no longer knows, and skips it when its turn comes', async () => {
    const harness = await started({ pathOf: (id) => (id === 2 ? null : `D:\\Music\\${id}.flac`) });
    harness.player.play([1, 2, 3], 0);
    await harness.settle();
    expect(held(harness)).toEqual(['1']);
    expect(harness.notices).toEqual([]);

    const { mpv } = harness;
    mpv().startCurrent();
    await harness.settle();
    mpv().finishCurrent();
    await harness.settle();
    expect(harness.notices).toHaveLength(1);
    expect(currentId(harness)).toBe(3);
    expect(held(harness)).toEqual(['3']);
  });

  it('tries again on retry after stopping', async () => {
    const harness = await started();
    harness.player.play([1], 0);
    await harness.settle();
    const { mpv } = harness;
    const failing = mpv().entry(0);
    mpv().startFile(failing.id);
    mpv().pos = -1;
    mpv().endFile(failing.id, 'error', FILE_GONE);
    await harness.settle();
    expect(harness.player.state().status).toBe('error');

    harness.player.retry();
    await harness.settle();
    expect(harness.player.state().status).toBe('loading');
    expect(harness.player.state().error).toBeNull();
    mpv().startCurrent();
    expect(harness.player.state().status).toBe('playing');
  });
});

describe('an audio device that fails', () => {
  it('never skips the track', async () => {
    const harness = await playing({ settings: { outputMode: 'exclusive' } });
    const { mpv } = harness;
    mpv().endFile(mpv().entry(0).id, 'error', DEVICE_FAILED);
    await harness.settle();
    expect(currentId(harness)).toBe(1);
    expect(harness.library.missing).toEqual([]);
  });

  it('falls back to shared from exclusive, resumes from the same place, saves it and says why', async () => {
    const harness = await playing({ settings: { outputMode: 'exclusive' } });
    const { mpv, settings, notices } = harness;
    harness.advance(1000);
    mpv().timePos(42);
    const before = mpv().commands.length;

    mpv().endFile(mpv().entry(0).id, 'error', DEVICE_FAILED);
    await harness.settle();

    expect(settings.get().outputMode).toBe('shared');
    expect(harness.player.state().outputMode).toBe('shared');
    expect(notices).toEqual([
      { level: 'warning', message: expect.stringContaining('Other apps') as string, action: null },
    ]);
    const commands = mpv().commands.slice(before);
    expect(commands[0]).toEqual(['set_property', 'audio-exclusive', false]);
    expect(commands[1]).toEqual(['loadfile', 'D:\\Music\\1.flac', 'replace', -1, 'start=42.000']);

    mpv().startCurrent();
    expect(harness.player.state().status).toBe('playing');
  });

  it('stays paused through the fallback if it was paused', async () => {
    const harness = await playing({ settings: { outputMode: 'exclusive' } });
    const { mpv } = harness;
    mpv().timePos(42);
    harness.player.pause();
    mpv().endFile(mpv().entry(0).id, 'error', DEVICE_FAILED);
    await harness.settle();
    mpv().startCurrent();
    expect(harness.player.state().status).toBe('paused');
    expect(mpv().properties.get('pause')).toBe(true);
  });

  it('ignores what mpv does with the rest of its list after the failure', async () => {
    const harness = await playing({ settings: { outputMode: 'exclusive' } });
    const { mpv } = harness;
    const [first, second] = [mpv().entry(0), mpv().entry(1)];
    mpv().endFile(first.id, 'error', DEVICE_FAILED);
    // mpv tries the next entry straight after, which also fails, before it hears anything.
    mpv().startFile(second.id);
    mpv().endFile(second.id, 'error', DEVICE_FAILED);
    await harness.settle();
    expect(currentId(harness)).toBe(1);
    expect(harness.settings.get().outputMode).toBe('shared');
    expect(harness.notices).toHaveLength(1);
    expect(mpv().sent('loadfile').at(-2)).toMatchObject(['loadfile', 'D:\\Music\\1.flac', 'replace']);
  });

  it('goes to an error with a retry when shared fails too, keeping the position', async () => {
    const harness = await playing({ settings: { outputMode: 'shared' } });
    const { mpv, notices, player } = harness;
    mpv().timePos(42);
    mpv().endFile(mpv().entry(0).id, 'error', DEVICE_FAILED);
    await harness.settle();

    expect(player.state()).toMatchObject({ status: 'error', queueIndex: 0 });
    expect(player.state().error).toMatchObject({ code: 'device_busy' });
    expect(currentId(harness)).toBe(1);
    expect(notices).toEqual([]);
    expect(mpv().playlist).toEqual([]);
    expect(player.position().positionMs).toBe(42_000);

    player.retry();
    await harness.settle();
    expect(mpv().sent('loadfile').at(-2)).toEqual(['loadfile', 'D:\\Music\\1.flac', 'replace', -1, 'start=42.000']);
    mpv().startCurrent();
    expect(player.state()).toMatchObject({ status: 'playing', error: null });
  });

  it('retries on play as well, from the error', async () => {
    const harness = await playing();
    const { mpv, player } = harness;
    mpv().timePos(10);
    mpv().endFile(mpv().entry(0).id, 'error', DEVICE_FAILED);
    await harness.settle();
    player.toggle();
    await harness.settle();
    expect(mpv().sent('loadfile').at(-2)).toEqual(['loadfile', 'D:\\Music\\1.flac', 'replace', -1, 'start=10.000']);
  });

  it('handles the failure arriving from a runtime toggle to exclusive', async () => {
    const harness = await playing();
    const { mpv, player, settings } = harness;
    mpv().timePos(5);
    player.setOutputMode('exclusive');
    await harness.settle();
    mpv().endFile(mpv().entry(0).id, 'error', DEVICE_FAILED);
    await harness.settle();
    expect(settings.get().outputMode).toBe('shared');
    expect(mpv().sent('loadfile').at(-2)).toEqual(['loadfile', 'D:\\Music\\1.flac', 'replace', -1, 'start=5.000']);
  });
});

describe('mpv exiting unexpectedly', () => {
  it('restores everything, reloads and seeks back, silently', async () => {
    const harness = await playing({
      settings: { volume: 37, muted: true, outputMode: 'exclusive', replayGainMode: 'track' },
    });
    const { mpv, spawned, notices } = harness;
    harness.advance(60_000);
    mpv().timePos(90);
    const loadIdBefore = harness.player.state().loadId;
    const old = mpv();

    old.exit();
    expect(spawned).toHaveLength(2);
    await harness.settle();

    const fresh = mpv();
    expect(fresh).not.toBe(old);
    expect(fresh.properties.get('volume')).toBe(37);
    expect(fresh.properties.get('mute')).toBe(true);
    expect(fresh.properties.get('audio-exclusive')).toBe(true);
    expect(fresh.properties.get('replaygain')).toBe('track');
    expect(fresh.sent('observe_property').length).toBeGreaterThan(0);
    expect(fresh.sent('loadfile')[0]).toEqual(['loadfile', 'D:\\Music\\1.flac', 'replace', -1, 'start=90.000']);
    expect(fresh.sent('loadfile')[1]).toMatchObject(['loadfile', 'D:\\Music\\2.flac', 'append']);
    expect(harness.player.state().loadId).toBeGreaterThan(loadIdBefore);
    expect(harness.player.state().status).toBe('loading');
    expect(notices).toEqual([]);
    expect(harness.states.every(({ error }) => error === null)).toBe(true);

    fresh.startCurrent();
    expect(harness.player.state().status).toBe('playing');
  });

  it('settings changed while it was down are what comes back', async () => {
    const harness = await playing();
    harness.advance(60_000);
    const old = harness.mpv();
    harness.player.setVolume(11);
    old.exit();
    await harness.settle();
    expect(harness.mpv().properties.get('volume')).toBe(11);
  });

  it('stays paused if it was paused', async () => {
    const harness = await playing();
    const { player } = harness;
    harness.mpv().timePos(9);
    player.pause();
    harness.advance(60_000);
    harness.mpv().exit();
    await harness.settle();
    expect(harness.mpv().properties.get('pause')).toBe(true);
    expect(harness.mpv().sent('loadfile')[0]).toEqual(['loadfile', 'D:\\Music\\1.flac', 'replace', -1, 'start=9.000']);
    harness.mpv().startCurrent();
    expect(player.state().status).toBe('paused');
  });

  it('restarts with nothing to reload, when nothing was playing', async () => {
    const harness = await started();
    harness.advance(60_000);
    harness.mpv().exit();
    await harness.settle();
    expect(harness.spawned).toHaveLength(2);
    expect(harness.mpv().sent('loadfile')).toEqual([]);
    expect(harness.player.state().status).toBe('idle');
  });

  it('leaves an ended queue ended', async () => {
    const harness = await playing({}, [1]);
    harness.mpv().finishCurrent();
    await harness.settle();
    harness.advance(60_000);
    harness.mpv().exit();
    await harness.settle();
    expect(harness.mpv().sent('loadfile')).toEqual([]);
    expect(harness.player.state().status).toBe('ended');
  });

  it('picks up a load that never got its answer', async () => {
    const harness = await started();
    harness.advance(60_000);
    harness.mpv().holdingReplies = true;
    harness.player.play([1, 2], 0);
    harness.mpv().exit();
    await harness.settle();
    expect(harness.mpv().sent('loadfile')[0]).toMatchObject(['loadfile', 'D:\\Music\\1.flac', 'replace']);
  });

  it('does not take a connection closing during a load for mpv refusing the file', async () => {
    const harness = await started();
    harness.advance(60_000);
    harness.mpv().holdingReplies = true;
    harness.player.play([1, 2], 0);
    const old = harness.mpv();

    // The connection goes first, with the load unanswered, and the exit only gets here later.
    old.closeConnection();
    await new Promise((resolve) => setImmediate(resolve));
    expect(harness.notices).toEqual([]);
    expect(currentId(harness)).toBe(1);

    old.exit();
    await harness.settle();
    expect(harness.notices).toEqual([]);
    expect(currentId(harness)).toBe(1);
    expect(harness.mpv().sent('loadfile')[0]).toMatchObject(['loadfile', 'D:\\Music\\1.flac', 'replace']);
  });

  it('does not skip a track when mpv stops answering in the middle of its load', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const harness = await started();
      harness.advance(60_000);
      const old = harness.mpv();
      old.holdingReplies = true;
      harness.player.play([1, 2], 0);
      vi.advanceTimersByTime(10_000);
      await harness.settle();

      expect(old.killed).toBe(true);
      expect(harness.notices).toEqual([]);
      expect(currentId(harness)).toBe(1);

      old.exit();
      await harness.settle();
      expect(harness.mpv().sent('loadfile')[0]).toMatchObject(['loadfile', 'D:\\Music\\1.flac', 'replace']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('comes back clear of the end, when it went down in the last moments of a track', async () => {
    const harness = await playing();
    harness.advance(60_000);
    harness.mpv().timePos(199.9);
    harness.mpv().exit();
    await harness.settle();
    expect(harness.mpv().sent('loadfile')[0]).toEqual([
      'loadfile',
      'D:\\Music\\1.flac',
      'replace',
      -1,
      'start=199.500',
    ]);
  });

  it('survives a crash in the middle of a load, and goes on to the track that was wanted', async () => {
    const harness = await playing();
    harness.player.next();
    harness.player.next();
    harness.advance(60_000);
    harness.mpv().exit();
    await harness.settle();
    expect(harness.mpv().sent('loadfile')[0]).toEqual(['loadfile', 'D:\\Music\\3.flac', 'replace']);
    expect(currentId(harness)).toBe(3);
  });

  it('after three quick failures is unavailable, saying what to do, with the library untouched', async () => {
    const harness = await playing();
    const { player, library } = harness;
    harness.mpv().timePos(20);
    for (let crash = 0; crash < 3; crash++) {
      harness.advance(1000);
      harness.mpv().exit();
    }
    await harness.settle();
    const state = player.state();
    expect(state.status).toBe('unavailable');
    expect(state.error).toMatchObject({ code: 'engine_unavailable' });
    expect(state.error?.message).toContain('Retry');
    expect(harness.spawned).toHaveLength(3);
    expect(library.missing).toEqual([]);
    expect(player.queue()).toHaveLength(5);
    expect(player.next()).toMatchObject({ ok: false, error: { code: 'engine_unavailable' } });
    expect(player.seek(1)).toMatchObject({ ok: false });
    expect(player.toggle()).toMatchObject({ ok: false });
  });

  it('comes back on retry at the same place', async () => {
    const harness = await playing();
    const { player } = harness;
    harness.mpv().timePos(20);
    for (let crash = 0; crash < 3; crash++) {
      harness.advance(1000);
      harness.mpv().exit();
    }
    await harness.settle();

    expect(player.retry()).toMatchObject({ ok: true });
    await harness.settle();
    expect(harness.spawned).toHaveLength(4);
    expect(player.state().error).toBeNull();
    expect(harness.mpv().sent('loadfile')[0]).toEqual(['loadfile', 'D:\\Music\\1.flac', 'replace', -1, 'start=20.000']);
    harness.mpv().startCurrent();
    expect(player.state().status).toBe('playing');
  });

  it('says it is still unavailable when retry finds nothing there', async () => {
    const harness = await started({ engineExists: () => false });
    expect(harness.player.retry()).toMatchObject({ ok: false, error: { code: 'engine_unavailable' } });
  });
});

describe('the library changing under it', () => {
  it('drops the queue and stops when the library is no longer there', async () => {
    const harness = await playing();
    harness.library.setStatus({ state: 'folder-missing', folder: 'D:\\Music' });
    await harness.settle();
    expect(harness.player.state()).toMatchObject({ status: 'idle', current: null, queueLength: 0 });
    expect(harness.mpv().playlist).toEqual([]);
  });

  it('drops the queue when another folder opens', async () => {
    const harness = await playing();
    harness.library.setStatus({
      state: 'ready',
      folder: 'E:\\Other',
      isEmpty: false,
      lastChanged: null,
      changedElsewhere: false,
    });
    await harness.settle();
    expect(harness.player.state()).toMatchObject({ status: 'idle', queueLength: 0 });
  });

  it('keeps playing when the same folder says ready again, as a rescan does', async () => {
    const harness = await playing();
    const before = harness.player.state();
    harness.library.setStatus({
      state: 'ready',
      folder: 'D:\\Music',
      isEmpty: false,
      lastChanged: { host: 'here', at: 1 },
      changedElsewhere: false,
    });
    await harness.settle();
    expect(harness.player.state()).toEqual(before);
  });

  it('has nothing left over when the library comes back', async () => {
    const harness = await playing();
    harness.library.setStatus({
      state: 'db-corrupt',
      folder: 'D:\\Music',
      cause: 'damaged',
      backupAt: null,
      message: 'x',
    });
    await harness.settle();
    harness.library.setStatus({
      state: 'ready',
      folder: 'D:\\Music',
      isEmpty: false,
      lastChanged: null,
      changedElsewhere: false,
    });
    await harness.settle();
    expect(harness.player.state()).toMatchObject({ status: 'idle', queueLength: 0 });
    expect(harness.player.queue()).toEqual([]);
  });

  it('refuses to queue from a library that is not there, saying why', async () => {
    const harness = await playing();
    harness.library.setStatus({ state: 'no-folder' });
    expect(harness.player.play([1], 0)).toMatchObject({ ok: false, error: { code: 'no_library' } });
    expect(harness.player.enqueue([1], 'end')).toMatchObject({ ok: false, error: { code: 'no_library' } });
  });
});

describe('rapid commands', () => {
  it('lands on the right track after next five times, without loading the ones in between', async () => {
    const tracks = Array.from({ length: 12 }, (_, index) => index + 1);
    const big = await started({ tracks: tracks.map((id) => makePlayable(id)) });
    big.player.play(tracks, 0);
    await big.settle();
    big.mpv().startCurrent();
    await big.settle();

    const { mpv } = big;
    mpv().holdingReplies = true;
    for (let press = 0; press < 5; press++) big.player.next();
    mpv().holdingReplies = false;
    await big.settle();

    expect(currentId(big)).toBe(6);
    expect(big.player.state().queueIndex).toBe(5);
    // Whatever it took to get there, what's held now is right, and no more than the first press got sent.
    expect(held(big)).toEqual(['6', '7']);
    const paths = mpv()
      .sent('loadfile')
      .map(([, path]) => path);
    expect(paths).not.toContain('D:\\Music\\4.flac');
    expect(paths).not.toContain('D:\\Music\\5.flac');

    mpv().startCurrent();
    await big.settle();
    expect(big.player.state().status).toBe('playing');
    expectConsistent(big);
  });

  it('ends up in the same place going next and back again in a burst', async () => {
    const harness = await playing();
    const { mpv } = harness;
    mpv().holdingReplies = true;
    harness.player.next();
    harness.player.next();
    harness.player.previous();
    harness.player.previous();
    harness.player.next();
    mpv().holdingReplies = false;
    await harness.settle();
    expect(currentId(harness)).toBe(2);
    expect(held(harness)).toEqual(['2', '3']);
    mpv().startCurrent();
    await harness.settle();
    expect(expectConsistent(harness).status).toBe('playing');
  });

  it('survives a seek during a load: the seek comes after, to the right place', async () => {
    const harness = await started();
    harness.player.play([1, 2], 0);
    harness.player.seek(1000);
    harness.player.seek(2000);
    harness.player.seek(3000);
    await harness.settle();
    const { mpv } = harness;
    mpv().startCurrent();
    await harness.settle();
    expect(mpv().sent('seek')).toEqual([['seek', 3, 'absolute']]);
    expect(expectConsistent(harness)).toMatchObject({ status: 'playing', queueIndex: 0 });
  });

  it('survives the output mode toggling during a load, ending on the last one', async () => {
    const harness = await started();
    harness.player.play([1, 2], 0);
    harness.player.setOutputMode('exclusive');
    harness.player.setOutputMode('shared');
    harness.player.setOutputMode('exclusive');
    await harness.settle();
    const { mpv } = harness;
    expect(mpv().properties.get('audio-exclusive')).toBe(true);
    expect(harness.settings.get().outputMode).toBe('exclusive');
    mpv().startCurrent();
    await harness.settle();
    expect(expectConsistent(harness)).toMatchObject({ status: 'playing', outputMode: 'exclusive' });
    expect(held(harness)).toEqual(['1', '2']);
  });

  it('survives pause and play in a burst during a load, ending on the last one', async () => {
    const harness = await started();
    harness.player.play([1, 2], 0);
    harness.player.toggle();
    harness.player.toggle();
    harness.player.toggle();
    await harness.settle();
    const { mpv } = harness;
    expect(mpv().properties.get('pause')).toBe(true);
    mpv().startCurrent();
    expect(harness.player.state().status).toBe('paused');
  });

  it('survives replacing the queue over and over', async () => {
    const harness = await started();
    for (const start of [1, 2, 3, 4, 5, 1, 2]) harness.player.play([start, 5], 0);
    await harness.settle();
    const { mpv } = harness;
    expect(currentId(harness)).toBe(2);
    expect(held(harness)).toEqual(['2', '5']);
    mpv().startCurrent();
    await harness.settle();
    expect(expectConsistent(harness).status).toBe('playing');
  });

  it('survives queue edits in a burst during a transition', async () => {
    const harness = await playing();
    const { mpv, player } = harness;
    mpv().holdingReplies = true;
    player.enqueue([4], 'next');
    player.enqueue([5], 'next');
    const queue = player.queue();
    player.removeFromQueue([queue[1]?.queueId ?? -1]);
    player.moveInQueue(queue[3]?.queueId ?? -1, 1);
    mpv().holdingReplies = false;
    await harness.settle();

    const nextTrack = player.queue()[1]?.track.id;
    expect(held(harness)).toEqual(['1', String(nextTrack)]);
    mpv().finishCurrent();
    await harness.settle();
    expect(currentId(harness)).toBe(nextTrack);
    expect(expectConsistent(harness).status).toBe('playing');
  });
});

describe('state events', () => {
  it('go out when something changed, and only then', async () => {
    const harness = await playing();
    harness.states.length = 0;
    harness.player.pause();
    harness.player.pause();
    expect(harness.states.map(({ status }) => status)).toEqual(['paused']);
    harness.player.resume();
    harness.player.resume();
    expect(harness.states.map(({ status }) => status)).toEqual(['paused', 'playing']);
  });

  it('say loading and then playing once for a load', async () => {
    const harness = await started();
    harness.player.play([1], 0);
    await harness.settle();
    harness.mpv().startCurrent();
    await harness.settle();
    expect(harness.states.map(({ status }) => status)).toEqual(['loading', 'playing']);
  });

  it('are what the player says, every time', async () => {
    const harness = await playing();
    harness.player.next();
    await harness.settle();
    harness.mpv().startCurrent();
    await harness.settle();
    expect(harness.lastState()).toEqual(harness.player.state());
  });
});

describe('quitting', () => {
  it('kills mpv at once, and starts nothing else when it goes', async () => {
    const harness = await playing();
    const { mpv, spawned, player } = harness;
    player.quit();
    expect(mpv().killed).toBe(true);
    mpv().exit();
    await harness.settle();
    expect(spawned).toHaveLength(1);
  });

  it('stops listening to the library', async () => {
    const harness = await playing();
    harness.player.quit();
    harness.library.setStatus({ state: 'no-folder' });
    expect(harness.player.queue()).toHaveLength(5);
  });
});

describe('CUE ranges', () => {
  const ALBUM = 100;
  /** Three contiguous tracks of one file, then another file. */
  const album = () => [
    makePlayable(1, { fileId: ALBUM, startMs: 0, endMs: 60_000 }, { isCueTrack: true, durationMs: 60_000 }),
    makePlayable(2, { fileId: ALBUM, startMs: 60_000, endMs: 120_000 }, { isCueTrack: true, durationMs: 60_000 }),
    makePlayable(3, { fileId: ALBUM, startMs: 120_000, endMs: null }, { isCueTrack: true, durationMs: 80_000 }),
    makePlayable(4),
  ];
  const onAlbum = (ids = [1, 2, 3, 4], at = 0) => playing({ tracks: album() }, ids, at);

  it('loads a contiguous stretch once, with no end', async () => {
    const harness = await onAlbum();
    expect(harness.mpv().sent('loadfile')).toEqual([
      ['loadfile', 'D:\\Music\\1.flac', 'replace'],
      ['loadfile', 'D:\\Music\\4.flac', 'append'],
    ]);
  });

  it('moves the queue as the position crosses the boundary, without a load', async () => {
    const harness = await onAlbum();
    const { mpv, player } = harness;
    const commands = mpv().commands.length;
    const loadId = player.state().loadId;

    mpv().timePos(59.9);
    expect(player.state().queueIndex).toBe(0);
    harness.advance(1000);
    mpv().timePos(60.05);
    expect(player.state()).toMatchObject({ queueIndex: 1, status: 'playing' });
    expect(currentId(harness)).toBe(2);
    expect(player.state().loadId).toBeGreaterThan(loadId);
    expect(player.position().positionMs).toBe(50);
    expect(harness.positions.at(-1)).toEqual({ loadId: player.state().loadId, positionMs: 50 });
    await harness.settle();
    expect(mpv().commands).toHaveLength(commands);
    expect(player.state().durationMs).toBe(60_000);
  });

  it('crosses several at once when ticks are far apart', async () => {
    const harness = await onAlbum();
    harness.mpv().timePos(125);
    expect(harness.player.state().queueIndex).toBe(2);
    expect(harness.player.position().positionMs).toBe(5000);
  });

  it('goes back with a seek within the file', async () => {
    const harness = await onAlbum();
    const { mpv, player } = harness;
    mpv().timePos(61);
    await harness.settle();
    const loads = mpv().sent('loadfile').length;

    player.previous();
    expect(currentId(harness)).toBe(1);
    await harness.settle();
    expect(mpv().sent('seek').at(-1)).toEqual(['seek', 0, 'absolute']);
    expect(mpv().sent('loadfile')).toHaveLength(loads);
    expect(player.state().status).toBe('playing');

    // A tick from before the seek can't send the queue forward again.
    harness.advance(1000);
    mpv().timePos(0.1);
    expect(currentId(harness)).toBe(1);
  });

  it('restarts a track from its own start, not the file’s', async () => {
    const harness = await onAlbum();
    const { mpv, player } = harness;
    mpv().timePos(65);
    await harness.settle();
    player.previous();
    await harness.settle();
    expect(currentId(harness)).toBe(2);
    expect(mpv().sent('seek').at(-1)).toEqual(['seek', 60, 'absolute']);
  });

  it('seeks relative to the track, and clamps to its own end', async () => {
    const harness = await onAlbum();
    const { mpv, player } = harness;
    mpv().timePos(61);
    await harness.settle();
    player.seek(10_000);
    await harness.settle();
    expect(mpv().sent('seek').at(-1)).toEqual(['seek', 70, 'absolute']);
    player.seek(90_000);
    await harness.settle();
    expect(mpv().sent('seek').at(-1)).toEqual(['seek', 119.5, 'absolute']);
  });

  it('goes to the next track in the file with a seek when asked', async () => {
    const harness = await onAlbum();
    const { mpv, player } = harness;
    const loads = mpv().sent('loadfile').length;
    player.next();
    await harness.settle();
    expect(currentId(harness)).toBe(2);
    expect(mpv().sent('seek').at(-1)).toEqual(['seek', 60, 'absolute']);
    expect(mpv().sent('loadfile')).toHaveLength(loads);
    expect(mpv().sent('playlist-next')).toEqual([]);
    expect(player.state().status).toBe('playing');
  });

  it('sets end when the next item is not contiguous', async () => {
    const harness = await onAlbum([1, 4]);
    expect(harness.mpv().sent('loadfile')[0]).toEqual(['loadfile', 'D:\\Music\\1.flac', 'replace', -1, 'end=60.000']);
    harness.mpv().finishCurrent();
    await harness.settle();
    expect(currentId(harness)).toBe(4);
  });

  it('loads a later track in the file from its start', async () => {
    const harness = await onAlbum([2, 3, 4]);
    expect(harness.mpv().sent('loadfile')[0]).toEqual(['loadfile', 'D:\\Music\\2.flac', 'replace', -1, 'start=60.000']);
    // Positions are relative to the track.
    harness.advance(1000);
    harness.mpv().timePos(61);
    expect(harness.player.position().positionMs).toBe(1000);
  });

  it('puts two separate ranges of one file in as two entries', async () => {
    const harness = await onAlbum([1, 3]);
    expect(harness.mpv().sent('loadfile')).toEqual([
      ['loadfile', 'D:\\Music\\1.flac', 'replace', -1, 'end=60.000'],
      ['loadfile', 'D:\\Music\\3.flac', 'append', -1, 'start=120.000'],
    ]);
  });

  it('seeks to go back to another range of the file, clearing and then setting end', async () => {
    const harness = await onAlbum([1, 3], 1);
    const { mpv, player } = harness;
    mpv().timePos(121);
    await harness.settle();
    const commands = mpv().commands.length;

    player.previous();
    await harness.settle();
    expect(currentId(harness)).toBe(1);
    expect(mpv().commands.slice(commands)).toEqual([
      ['seek', 0, 'absolute'],
      ['set_property', 'file-local-options/end', '60.000'],
      ['loadfile', 'D:\\Music\\3.flac', 'append', -1, 'start=120.000'],
    ]);
  });

  it('moves end when what comes after the current track changes, without touching what plays', async () => {
    const harness = await onAlbum();
    const { mpv, player } = harness;
    const queue = player.queue();
    const before = mpv()
      .sent('loadfile')
      .filter(([, , mode]) => mode === 'replace').length;
    player.removeFromQueue([queue[1]?.queueId ?? -1]);
    await harness.settle();
    // 1 and 3 aren't contiguous, so 1 has to stop at its own end now, and 3 goes in behind it.
    expect(mpv().properties.get('file-local-options/end')).toBe('60.000');
    expect(
      mpv()
        .sent('loadfile')
        .filter(([, , mode]) => mode === 'replace'),
    ).toHaveLength(before);
    expect(mpv().sent('loadfile').at(-1)).toEqual(['loadfile', 'D:\\Music\\3.flac', 'append', -1, 'start=120.000']);
  });

  it('skips the whole stretch when its entry ends, even if no tick saw the boundaries', async () => {
    const harness = await onAlbum();
    harness.mpv().finishCurrent();
    await harness.settle();
    expect(currentId(harness)).toBe(4);
    expect(harness.player.state().queueIndex).toBe(3);
  });

  it('marks every track from the file missing, when the file is gone', async () => {
    const harness = await onAlbum();
    const { mpv, player } = harness;
    mpv().pos = 1;
    mpv().endFile(mpv().entry(0).id, 'error', FILE_GONE);
    mpv().startCurrent();
    await harness.settle();
    expect(player.queue().map(({ track }) => track.isMissing)).toEqual([true, true, true, false]);
    expect(currentId(harness)).toBe(4);
  });

  it('comes back from a crash on the right track at the right place', async () => {
    const harness = await onAlbum();
    const { mpv } = harness;
    harness.advance(60_000);
    mpv().timePos(70);
    mpv().exit();
    await harness.settle();
    expect(mpv().sent('loadfile')[0]).toEqual(['loadfile', 'D:\\Music\\2.flac', 'replace', -1, 'start=70.000']);
    expect(currentId(harness)).toBe(2);
    expect(harness.player.position().positionMs).toBe(10_000);
  });

  it('uses the track’s own length, not the file’s', async () => {
    const harness = await onAlbum();
    expect(harness.player.state().durationMs).toBe(60_000);
  });
});
