import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Tooltip as RadixTooltip } from 'radix-ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MiniPlayer } from '@/features/MiniPlayer/MiniPlayer';
import { isQueueSheetOpen, setQueueSheetOpen } from '@/lib/queueSheet';
import { resetRendererState, stubApi, type StubbedApi } from '@/lib/testing';
import { TOAST_DURATION_MS } from '@/lib/toastStore';
import { backInMini } from '@/lib/windowActions';

let api: StubbedApi;

beforeEach(() => {
  resetRendererState();
  api = stubApi({ 'window.setMiniQueue': 'below' });
});

function mount() {
  render(
    <RadixTooltip.Provider>
      <MiniPlayer queue={<div data-testid="queue-panel" />} />
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

  it('asks main to grow the window when the Queue button opens the queue', async () => {
    mount();
    expect(screen.queryByTestId('queue-panel')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Queue' }));
    expect(screen.getByTestId('queue-panel')).not.toBeNull();
    await waitFor(() => expect(api.invoke).toHaveBeenCalledWith('window.setMiniQueue', { open: true }));
    expect(screen.getByRole('button', { name: 'Close queue' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('closes the queue before it closes the window, on Escape', () => {
    setQueueSheetOpen(true);
    backInMini();
    expect(isQueueSheetOpen()).toBe(false);
    expect(api.invoke).not.toHaveBeenCalledWith('window.setMiniPlayer', { enabled: false });

    backInMini();
    expect(api.invoke).toHaveBeenCalledWith('window.setMiniPlayer', { enabled: false });
  });
});
