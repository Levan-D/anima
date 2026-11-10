import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { Tooltip as RadixTooltip } from 'radix-ui';
import { beforeEach, describe, expect, it } from 'vitest';
import { IDLE_PLAYER, setPlayerState } from '@/lib/playerStore';
import { queryClient } from '@/lib/queryClient';
import { playerStateWith, resetRendererState, stubApi, track, type StubbedApi } from '@/lib/testing';
import { useToasts } from '@/lib/toastStore';
import { StationMarks } from './StationMarks';

let api: StubbedApi;

function mount() {
  return render(
    <QueryClientProvider client={queryClient}>
      <RadixTooltip.Provider>
        <StationMarks />
      </RadixTooltip.Provider>
    </QueryClientProvider>,
  );
}

const playing = (stationId: number | null) =>
  playerStateWith({
    current: track({ id: 7, title: 'Infused' }),
    radio: { ...IDLE_PLAYER.radio, isSource: true, stationId },
  });

beforeEach(() => {
  resetRendererState();
  api = stubApi({
    'moods.list': [{ id: 3, name: 'Study', covers: [], songs: 280 }],
    'moods.mark': undefined as never,
  });
});

describe('marks while a mood station plays', () => {
  it('are only there while one is playing', () => {
    act(() => setPlayerState(playing(null)));
    mount();
    expect(screen.queryByRole('button', { name: /Not for/ })).toBeNull();
  });

  it('say the song on is for the station or not, and say so', async () => {
    act(() => setPlayerState(playing(3)));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Not for Study' }));
    fireEvent.click(screen.getByRole('button', { name: 'Belongs in Study' }));
    await waitFor(() =>
      expect(
        api.invoke.mock.calls.filter(([name]) => name === 'moods.mark').map(([, input]) => input as unknown),
      ).toEqual([
        { stationId: 3, trackId: 7, isYes: false },
        { stationId: 3, trackId: 7, isYes: true },
      ]),
    );
    const toasts = renderHook(() => useToasts());
    await waitFor(() =>
      expect(toasts.result.current.map(({ message }) => message)).toContain(
        'Marked Infused as belonging in Study. What plays next takes it into account.',
      ),
    );
  });
});
