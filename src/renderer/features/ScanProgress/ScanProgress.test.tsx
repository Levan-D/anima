import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ScanProgress } from '@/features/ScanProgress/ScanProgress';
import { queryClient } from '@/lib/queryClient';
import { IDLE_SCAN, resetRendererState, stubApi, type StubbedApi } from '@/lib/testing';
import { useLibrarySync } from '@/lib/useLibrarySync';

function Mounted() {
  useLibrarySync();
  return <ScanProgress />;
}

function mount() {
  render(
    <QueryClientProvider client={queryClient}>
      <Mounted />
    </QueryClientProvider>,
  );
}

let api: StubbedApi;

beforeEach(() => {
  resetRendererState();
  api = stubApi({
    'library.status': { state: 'no-folder' },
    'scan.state': IDLE_SCAN,
    'scan.cancel': undefined as never,
  });
});

async function scanning(state: Partial<typeof IDLE_SCAN>) {
  await waitFor(() => expect(queryClient.getQueryData(['scan'])).toBeTruthy());
  act(() => api.emit('scan.state', { ...IDLE_SCAN, ...state }));
  await waitFor(() => expect(screen.queryByTestId('scan-progress')).not.toBeNull());
}

describe('ScanProgress', () => {
  it('shows nothing when no scan is running', async () => {
    mount();
    await waitFor(() => expect(queryClient.getQueryData(['scan'])).toBeTruthy());
    expect(screen.queryByTestId('scan-progress')).toBeNull();
  });

  it.each([
    ['walking', 'Looking for music', 120, 0, '120 files'],
    ['reading', 'Reading tags', 5_719, 1_204, '1,204 of 5,719'],
    ['hashing', 'Checking the audio', 200, 50, '50 of 200'],
    ['art', 'Preparing album art', 685, 10, '10 of 685'],
  ] as const)('%s reads as plain words and a count', async (phase, words, filesFound, filesDone, count) => {
    mount();
    await scanning({ phase, filesFound, filesDone });
    const progress = screen.getByTestId('scan-progress');
    expect(progress.textContent).toContain(words);
    expect(progress.textContent).toContain(count);
  });

  it('keeps the line under the words, where it can not pass for the active tab', async () => {
    mount();
    await scanning({ phase: 'reading', filesFound: 10, filesDone: 1 });
    const progress = screen.getByTestId('scan-progress');
    expect(progress.lastElementChild).toBe(screen.getByRole('progressbar'));
  });

  it('has no count until there is something to count', async () => {
    mount();
    await scanning({ phase: 'walking' });
    expect(screen.getByTestId('scan-progress').textContent).toContain('Looking for music');
    expect(screen.getByTestId('scan-progress').textContent).not.toContain('·');
  });

  it('fills the line as far along as it is, and has no number while the total is unknown', async () => {
    mount();
    await scanning({ phase: 'walking', filesFound: 3 });
    expect(screen.getByRole('progressbar').hasAttribute('aria-valuenow')).toBe(false);

    act(() => api.emit('scan.state', { ...IDLE_SCAN, phase: 'reading', filesFound: 4, filesDone: 1 }));
    await waitFor(() => expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0.25'));
  });

  it('Cancel asks main to stop, and stays busy until it has', async () => {
    mount();
    await scanning({ phase: 'reading', filesFound: 10, filesDone: 1 });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(api.invoke).toHaveBeenCalledWith('scan.cancel'));
    expect(screen.getByRole('button', { name: 'Cancel' }).getAttribute('aria-busy')).toBe('true');

    act(() => api.emit('scan.state', { ...IDLE_SCAN }));
    await waitFor(() => expect(screen.queryByTestId('scan-progress')).toBeNull());
  });
});
