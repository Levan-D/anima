import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Toaster } from '@/components/ui/Toaster';
import { dismissToast, showToast, TOAST_DURATION_MS } from '@/lib/toastStore';

const shown: number[] = [];

function show(...args: Parameters<typeof showToast>): number {
  let id = 0;
  act(() => {
    id = showToast(...args);
  });
  shown.push(id);
  return id;
}

afterEach(() => {
  act(() => {
    for (const id of shown.splice(0)) dismissToast(id);
  });
  vi.useRealTimers();
});

describe('Toaster', () => {
  it('draws the levels apart with an edge and an icon, from tokens', () => {
    render(<Toaster />);
    show({ message: 'Cool', level: 'info' });
    show({ message: 'Warm', level: 'warning' });
    show({ message: 'Hot', level: 'error' });
    const [info, warning, error] = document.querySelectorAll('[data-toast]');
    expect(info?.getAttribute('data-level')).toBe('info');
    expect(warning?.className).toContain('border-warning');
    expect(error?.className).toContain('border-danger');
    expect(info?.querySelector('svg')?.getAttribute('class')).toContain('text-text-muted');
    expect(warning?.querySelector('svg')?.getAttribute('class')).toContain('text-warning');
    expect(error?.querySelector('svg')?.getAttribute('class')).toContain('text-danger');
  });

  it('shows no bar without progress, one that fills, and one that cannot say how far', () => {
    render(<Toaster />);
    const id = show({ message: 'Plain' });
    expect(screen.queryByRole('progressbar')).toBeNull();

    show({ id, message: 'Going', progress: 'indeterminate' });
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBeNull();

    show({ id, message: 'Going', progress: 0.25 });
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0.25');
    expect(document.querySelectorAll('[data-toast]')).toHaveLength(1);
  });

  it('stays up while it has progress, and then closes on its own like any other', () => {
    vi.useFakeTimers();
    render(<Toaster />);
    const id = show({ message: 'Going', progress: 0.5 });

    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS * 3);
    });
    expect(document.querySelector('[data-toast]')?.getAttribute('data-state')).toBe('open');

    show({ id, message: 'Done' });
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS + 1);
    });
    expect(document.querySelector('[data-toast][data-state="open"]')).toBeNull();
  });

  it('shows a toast from the store, and takes it down when dismissed', () => {
    render(<Toaster />);
    act(() => {
      showToast({ message: 'Exclusive mode is busy' });
    });
    expect(screen.getAllByText('Exclusive mode is busy').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  it('runs a toast action', () => {
    const run = vi.fn();
    render(<Toaster />);
    act(() => {
      showToast({ message: 'That file is gone', level: 'error', action: { label: 'Reveal folder', run } });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Reveal folder' }));

    expect(run).toHaveBeenCalledOnce();
  });
});
