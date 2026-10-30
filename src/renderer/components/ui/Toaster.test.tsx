import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Toaster } from '@/components/ui/Toaster';
import { showToast } from '@/lib/toastStore';

describe('Toaster', () => {
  it('shows a toast from the store, and takes it down when dismissed', () => {
    render(<Toaster />);
    act(() => showToast({ message: 'Exclusive mode is busy' }));
    expect(screen.getAllByText('Exclusive mode is busy').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  it('runs a toast action', () => {
    const run = vi.fn();
    render(<Toaster />);
    act(() => showToast({ message: 'That file is gone', level: 'error', action: { label: 'Reveal folder', run } }));

    fireEvent.click(screen.getByRole('button', { name: 'Reveal folder' }));

    expect(run).toHaveBeenCalledOnce();
  });
});
