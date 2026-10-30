import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { dismissToast, showToast, useToasts } from '@/lib/toastStore';

const openToasts = () => renderHook(() => useToasts()).result.current.filter((toast) => toast.open);

beforeEach(() => {
  for (const toast of openToasts()) dismissToast(toast.id);
});

describe('the toast store', () => {
  it('shows a toast, with info as the default level', () => {
    act(() => showToast({ message: 'Hello' }));
    expect(openToasts()).toMatchObject([{ message: 'Hello', level: 'info', action: null }]);
  });

  it('closes a toast without unmounting it, so it can animate out', () => {
    act(() => showToast({ message: 'Hello' }));
    const [toast] = openToasts();

    act(() => dismissToast(toast!.id));

    const { result } = renderHook(() => useToasts());
    expect(result.current.find(({ id }) => id === toast!.id)?.open).toBe(false);
  });

  it('sweeps closed toasts away when the next one arrives', () => {
    act(() => showToast({ message: 'First' }));
    const [first] = openToasts();
    act(() => dismissToast(first!.id));

    act(() => showToast({ message: 'Second' }));

    const { result } = renderHook(() => useToasts());
    expect(result.current.map(({ message }) => message)).toEqual(['Second']);
  });

  it('saying the same thing twice replaces it, rather than stacking up copies', () => {
    act(() => {
      showToast({ message: 'Other' });
      showToast({ message: 'Still not there' });
      showToast({ message: 'Still not there' });
      showToast({ message: 'Still not there' });
    });
    expect(openToasts().map(({ message }) => message)).toEqual(['Other', 'Still not there']);
  });

  it('keeps the screen from filling up', () => {
    act(() => {
      for (const message of ['1', '2', '3', '4', '5']) showToast({ message });
    });
    expect(openToasts().map(({ message }) => message)).toEqual(['3', '4', '5']);
  });
});
