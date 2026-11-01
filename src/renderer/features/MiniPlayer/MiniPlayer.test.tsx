import { act, render, screen } from '@testing-library/react';
import { Tooltip as RadixTooltip } from 'radix-ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MiniPlayer } from '@/features/MiniPlayer/MiniPlayer';
import { resetRendererState, stubApi, type StubbedApi } from '@/lib/testing';
import { TOAST_DURATION_MS } from '@/lib/toastStore';
import { backInMini } from '@/lib/windowActions';

let api: StubbedApi;

beforeEach(() => {
  resetRendererState();
  api = stubApi();
});

function mount() {
  render(
    <RadixTooltip.Provider>
      <MiniPlayer />
    </RadixTooltip.Provider>,
  );
}

describe('the mini player', () => {
  it('says what would have been a toast, for as long as a toast lasts', () => {
    vi.useFakeTimers();
    try {
      mount();
      act(() => api.emit('notice', { id: 1, level: 'warning', message: 'That was skipped', action: null }));
      expect(screen.getByTestId('mini-message').textContent).toBe('That was skipped');

      act(() => {
        vi.advanceTimersByTime(TOAST_DURATION_MS);
      });
      expect(screen.queryByTestId('mini-message')).toBeNull();
      expect(screen.queryByTestId('mini-artist')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('goes back to the main window on Escape', () => {
    backInMini();
    expect(api.invoke).toHaveBeenCalledWith('window.setMiniPlayer', { enabled: false });
  });
});
