import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/app/App';
import { AppLayout } from '@/app/AppLayout';
import type * as AppLayoutModule from '@/app/AppLayout';
import { Toaster } from '@/components/ui/Toaster';

vi.mock('@/components/ui/Toaster', () => ({ Toaster: vi.fn(() => null) }));
vi.mock('@/app/AppLayout', async (importActual) => ({
  AppLayout: vi.fn((await importActual<typeof AppLayoutModule>()).AppLayout),
}));

const invoke = vi.fn(() => Promise.resolve({ ok: true, value: undefined }));

beforeEach(() => {
  invoke.mockClear();
  vi.mocked(Toaster).mockReset();
  vi.mocked(AppLayout).mockReset();
  vi.stubGlobal('api', { invoke, on: vi.fn() });
  // React logs every caught error to the console, which is noise here.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('App', () => {
  it('renders the panels', () => {
    render(<App />);
    expect(screen.getByRole('tab', { name: 'Albums' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the panels when the toasts break, and logs it', () => {
    vi.mocked(Toaster).mockImplementation(() => {
      throw new Error('toaster blew up');
    });
    render(<App />);
    expect(screen.getByRole('tab', { name: 'Albums' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(invoke).toHaveBeenCalledWith('system.logError', expect.objectContaining({ message: 'toaster blew up' }));
  });

  it('shows a way out instead of a blank window when the layout itself breaks', () => {
    vi.mocked(AppLayout).mockImplementation(() => {
      throw new Error('layout blew up');
    });
    render(<App />);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
