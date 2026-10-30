import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '@/app/ErrorBoundary';
import { AppFailure } from '@/lib/api';

const invoke = vi.fn(() => Promise.resolve({ ok: true, value: undefined }));

let shouldThrow: Error | null;

function Risky() {
  if (shouldThrow) throw shouldThrow;
  return <p>All good</p>;
}

beforeEach(() => {
  invoke.mockClear();
  vi.stubGlobal('api', { invoke, on: vi.fn() });
  // React logs every caught error to the console, which is noise here.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('ErrorBoundary', () => {
  it('renders its children when nothing is wrong', () => {
    shouldThrow = null;
    render(
      <ErrorBoundary>
        <Risky />
      </ErrorBoundary>,
    );
    expect(screen.getByText('All good')).toBeTruthy();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('shows an error with a way out, instead of crashing the app', () => {
    shouldThrow = new Error('kaboom');
    render(
      <ErrorBoundary>
        <Risky />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert').textContent).toContain('Something went wrong');
    expect(screen.getByRole('alert').textContent).not.toContain('kaboom');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('shows the message of an expected failure', () => {
    shouldThrow = new AppFailure({ code: 'not_found', message: 'That album is gone' });
    render(
      <ErrorBoundary>
        <Risky />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert').textContent).toContain('That album is gone');
  });

  it('logs through system.logError, with the component stack', () => {
    shouldThrow = new Error('kaboom');
    render(
      <ErrorBoundary>
        <Risky />
      </ErrorBoundary>,
    );
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith('system.logError', {
      message: 'kaboom',
      stack: expect.stringContaining('Risky') as string,
    });
  });

  it('recovers when Try again finds the problem gone', () => {
    shouldThrow = new Error('kaboom');
    render(
      <ErrorBoundary>
        <Risky />
      </ErrorBoundary>,
    );

    shouldThrow = null;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(screen.getByText('All good')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the error again if the problem is still there', () => {
    shouldThrow = new Error('kaboom');
    render(
      <ErrorBoundary>
        <Risky />
      </ErrorBoundary>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('shows its fallback, if it has one', () => {
    shouldThrow = new Error('kaboom');
    render(
      <ErrorBoundary fallback={<p>Quietly gone</p>}>
        <Risky />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Quietly gone')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(invoke).toHaveBeenCalledOnce();
  });

  it('keeps a failure inside its own boundary', () => {
    shouldThrow = new Error('kaboom');
    render(
      <>
        <ErrorBoundary>
          <Risky />
        </ErrorBoundary>
        <ErrorBoundary>
          <p>The other panel</p>
        </ErrorBoundary>
      </>,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('The other panel')).toBeTruthy();
  });
});
