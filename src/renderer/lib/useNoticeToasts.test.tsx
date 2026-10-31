import { act, render, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Notice } from '@shared/domain';
import { useSettingsDialog } from '@/lib/settingsDialog';
import { resetRendererState, stubApi, type StubbedApi } from '@/lib/testing';
import { useToasts } from '@/lib/toastStore';
import { useNoticeToasts } from '@/lib/useNoticeToasts';

function Notices() {
  useNoticeToasts();
  return null;
}

let api: StubbedApi;

beforeEach(() => {
  resetRendererState();
  api = stubApi({
    'system.revealTrack': { failure: 'file_missing', message: 'Gone' },
  });
});

// One render, kept: waitFor retries on any DOM change, so rendering inside it would never settle.
function watchToasts() {
  const { result } = renderHook(() => useToasts());
  return () => result.current.at(-1);
}

function notice(sent: Notice) {
  render(<Notices />);
  act(() => api.emit('notice', sent));
}

describe('notices', () => {
  it('open-storage opens Settings', () => {
    const latestToast = watchToasts();
    notice({ id: 1, level: 'info', message: 'Scan finished', action: { kind: 'open-storage', label: 'See issues' } });

    const toast = latestToast();
    expect(toast).toMatchObject({ message: 'Scan finished', level: 'info' });
    expect(toast?.action?.label).toBe('See issues');
    act(() => toast?.action?.run());

    const { result } = renderHook(() => useSettingsDialog((state) => state));
    expect(result.current).toEqual({ isOpen: true, tab: 'library' });
  });

  it('reveal-track asks main to reveal that track, and says so when it cannot', async () => {
    const latestToast = watchToasts();
    notice({
      id: 3,
      level: 'error',
      message: 'Skipped',
      action: { kind: 'reveal-track', label: 'Reveal', trackId: 7 },
    });

    latestToast()?.action?.run();

    expect(api.invoke).toHaveBeenCalledWith('system.revealTrack', { trackId: 7 });
    await waitFor(() => expect(latestToast()).toMatchObject({ message: 'Gone', level: 'error' }));
  });

  it('a notice with no action is just the message', () => {
    const latestToast = watchToasts();
    notice({ id: 4, level: 'warning', message: 'Heads up', action: null });
    expect(latestToast()).toMatchObject({ message: 'Heads up', level: 'warning', action: null });
  });
});
