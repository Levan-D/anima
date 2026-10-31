import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { dismissToast, showToast, useToasts } from '@/lib/toastStore';

const openToasts = () => renderHook(() => useToasts()).result.current.filter((toast) => toast.open);

beforeEach(() => {
  for (const toast of openToasts()) dismissToast(toast.id);
});

describe('the toast store', () => {
  it('shows a toast, with info as the default level', () => {
    act(() => {
      showToast({ message: 'Hello' });
    });
    expect(openToasts()).toMatchObject([{ message: 'Hello', level: 'info', action: null }]);
  });

  it('closes a toast without unmounting it, so it can animate out', () => {
    act(() => {
      showToast({ message: 'Hello' });
    });
    const [toast] = openToasts();

    act(() => {
      dismissToast(toast!.id);
    });

    const { result } = renderHook(() => useToasts());
    expect(result.current.find(({ id }) => id === toast!.id)?.open).toBe(false);
  });

  it('sweeps closed toasts away when the next one arrives', () => {
    act(() => {
      showToast({ message: 'First' });
    });
    const [first] = openToasts();
    act(() => {
      dismissToast(first!.id);
    });

    act(() => {
      showToast({ message: 'Second' });
    });

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

  it('an id updates that toast in place, and a toast with progress keeps its place when the screen fills up', () => {
    let id = 0;
    act(() => {
      id = showToast({ message: 'Importing', progress: 'indeterminate' });
      showToast({ id, message: 'Importing 40%', progress: 0.4 });
    });
    expect(openToasts()).toMatchObject([{ id, message: 'Importing 40%', progress: 0.4 }]);

    act(() => {
      for (const message of ['1', '2', '3']) showToast({ message });
    });
    expect(openToasts().map(({ message }) => message)).toEqual(['Importing 40%', '2', '3']);

    act(() => {
      showToast({ id, message: 'Done', level: 'warning' });
    });
    expect(openToasts()[0]).toMatchObject({ id, message: 'Done', level: 'warning', progress: null });
  });

  it('dismissed while running it stays away, until there is an outcome to say', () => {
    let id = 0;
    act(() => {
      id = showToast({ message: 'Importing', progress: 0 });
      dismissToast(id);
      showToast({ id, message: 'Importing', progress: 0.5 });
    });
    expect(openToasts()).toEqual([]);

    act(() => {
      showToast({ id, message: 'Finished' });
    });
    expect(openToasts()).toMatchObject([{ id, message: 'Finished' }]);
  });

  it('the same words do not replace a toast that is running', () => {
    act(() => {
      showToast({ message: 'Importing', progress: 0.5 });
      showToast({ message: 'Importing' });
    });
    expect(openToasts()).toHaveLength(2);
  });

  it('keeps the screen from filling up', () => {
    act(() => {
      for (const message of ['1', '2', '3', '4', '5']) showToast({ message });
    });
    expect(openToasts().map(({ message }) => message)).toEqual(['3', '4', '5']);
  });
});
