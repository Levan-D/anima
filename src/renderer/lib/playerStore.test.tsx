import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { IDLE_PLAYER, playerState, setPlayerState, startPlayerSync, usePlayer } from '@/lib/playerStore';
import { playerStateWith, resetRendererState, stubApi, track } from '@/lib/testing';

beforeEach(() => {
  resetRendererState();
});

describe('the player store', () => {
  it('starts with nothing playing, and what the settings default to', () => {
    expect(playerState()).toEqual(IDLE_PLAYER);
    expect(playerState()).toMatchObject({ status: 'idle', current: null, volume: 100 });
  });

  it('takes what main says when it starts', async () => {
    const song = track();
    stubApi({ 'player.state': playerStateWith({ status: 'paused', current: song }) });

    await startPlayerSync();

    expect(playerState()).toMatchObject({ status: 'paused', current: song });
  });

  it('follows every state event after that', async () => {
    const api = stubApi({ 'player.state': playerStateWith({ status: 'paused' }) });
    await startPlayerSync();

    act(() => api.emit('player.state', playerStateWith({ status: 'playing' })));

    expect(playerState().status).toBe('playing');
  });

  it('an event that beats the first reply is newer than it, and stays', async () => {
    let answer: (state: ReturnType<typeof playerStateWith>) => void = () => {};
    const api = stubApi({
      'player.state': () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });
    const started = startPlayerSync();

    api.emit('player.state', playerStateWith({ status: 'playing', loadId: 2 }));
    answer(playerStateWith({ status: 'loading', loadId: 1 }));
    await started;

    expect(playerState()).toMatchObject({ status: 'playing', loadId: 2 });
  });

  it('stays idle when main can not say', async () => {
    stubApi({ 'player.state': { failure: 'unexpected', message: 'No' } });
    await startPlayerSync();
    expect(playerState()).toEqual(IDLE_PLAYER);
  });

  it('re-renders whoever selected a primitive only when that primitive changes', () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return usePlayer((state) => state.status);
    });
    expect(renders).toBe(1);

    act(() => setPlayerState(playerStateWith({ volume: 40 })));
    act(() => setPlayerState(playerStateWith({ volume: 41 })));
    expect(renders).toBe(1);

    act(() => setPlayerState(playerStateWith({ volume: 41, status: 'playing' })));
    expect(renders).toBe(2);
    expect(result.current).toBe('playing');
  });
});
