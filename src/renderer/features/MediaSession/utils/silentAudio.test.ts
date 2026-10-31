import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSilentAudio, type SilentAudioElement } from './silentAudio';

type FakeElement = SilentAudioElement & {
  plays: number;
  pauses: number;
  fire: (type: string) => void;
};

function fakeElement(): FakeElement {
  const listeners = new Map<string, () => void>();
  return {
    loop: false,
    volume: 1,
    src: '',
    plays: 0,
    pauses: 0,
    play() {
      this.plays++;
      return Promise.resolve();
    },
    pause() {
      this.pauses++;
    },
    addEventListener(type: string, listener: () => void) {
      listeners.set(type, listener);
    },
    fire(type: string) {
      listeners.get(type)?.();
    },
  } as FakeElement;
}

let created: FakeElement[];
const last = () => created.at(-1)!;

function audio() {
  return createSilentAudio(() => {
    const element = fakeElement();
    created.push(element);
    return element;
  });
}

beforeEach(() => {
  created = [];
  vi.useFakeTimers();
  URL.createObjectURL = () => 'blob:silence';
  URL.revokeObjectURL = () => {};
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createSilentAudio', () => {
  it('stays out of the way with nothing to play', () => {
    const silent = audio();
    silent.follow('nothing');
    expect(created).toHaveLength(0);
  });

  it('plays at volume 0 on a loop, not muted', () => {
    audio().follow('playing');
    expect(last()).toMatchObject({ volume: 0, loop: true, src: 'blob:silence', plays: 1 });
    expect('muted' in last()).toBe(false);
  });

  it('really pauses when the player does, and plays again', async () => {
    const silent = audio();
    silent.follow('playing');
    await vi.advanceTimersByTimeAsync(0);
    silent.follow('paused');
    expect(last().pauses).toBe(1);
    silent.follow('playing');
    expect(last().plays).toBe(2);
    expect(created).toHaveLength(1);
  });

  it('plays once and stops when starting paused, so there is a session for the keys', async () => {
    audio().follow('paused');
    expect(last().plays).toBe(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(last().pauses).toBe(1);
  });

  it('replaces a broken element, waiting longer each time', async () => {
    audio().follow('playing');

    last().fire('error');
    await vi.advanceTimersByTimeAsync(999);
    expect(created).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(created).toHaveLength(2);
    expect(last().plays).toBe(1);

    last().fire('error');
    await vi.advanceTimersByTimeAsync(1_999);
    expect(created).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(created).toHaveLength(3);
  });

  it('waits from the start again after a long healthy run', async () => {
    audio().follow('playing');
    last().fire('error');
    await vi.advanceTimersByTimeAsync(1_000);
    last().fire('playing');
    await vi.advanceTimersByTimeAsync(30_000);

    last().fire('error');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(created).toHaveLength(3);
  });

  it('does not bring back an element while paused', async () => {
    const silent = audio();
    silent.follow('playing');
    await vi.advanceTimersByTimeAsync(0);
    last().fire('error');
    silent.follow('paused');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(created).toHaveLength(1);

    silent.follow('playing');
    expect(created).toHaveLength(2);
  });

  it('ignores an element it has already let go of', async () => {
    audio().follow('playing');
    const first = last();
    first.fire('error');
    await vi.advanceTimersByTimeAsync(1_000);
    first.fire('error');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(created).toHaveLength(2);
  });

  it('stops for good', async () => {
    const silent = audio();
    silent.follow('playing');
    last().fire('error');
    silent.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(created).toHaveLength(1);
    silent.follow('playing');
    expect(created).toHaveLength(1);
  });
});
