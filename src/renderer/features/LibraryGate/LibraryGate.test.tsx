import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { LibraryStatus } from '@shared/domain';
import { Toaster } from '@/components/ui/Toaster';
import { LibraryGate } from '@/features/LibraryGate/LibraryGate';
import { currentPlace, openAlbum, useNavigation } from '@/lib/navigation';
import { queryClient } from '@/lib/queryClient';
import { READY, resetRendererState, stubApi, type StubbedApi } from '@/lib/testing';

const BACKUP_AT = new Date(2026, 9, 29, 12).getTime();
const RESTORE = 'Restore the backup from Oct 29, 2026';

const CORRUPT: Extract<LibraryStatus, { state: 'db-corrupt' }> = {
  state: 'db-corrupt',
  folder: 'D:\\Music',
  cause: 'damaged',
  backupAt: BACKUP_AT,
  message: 'The file is damaged, so it was left as it is.',
};

function mount() {
  return render(
    <QueryClientProvider client={queryClient}>
      <LibraryGate>
        <p>The library</p>
      </LibraryGate>
      <Toaster />
    </QueryClientProvider>,
  );
}

function statusIs(status: LibraryStatus, more: Parameters<typeof stubApi>[0] = {}): StubbedApi {
  return stubApi({ 'library.status': status, ...more });
}

beforeEach(() => {
  resetRendererState();
});

describe('LibraryGate', () => {
  it('shows nothing but the window while it asks, so nothing flashes', () => {
    statusIs(READY);
    mount();
    expect(screen.queryByText('The library')).toBeNull();
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('lets the app through once the library is ready', async () => {
    statusIs(READY);
    mount();
    expect(await screen.findByText('The library')).toBeTruthy();
  });

  it('with no folder: one line, one button, and the button asks main for a folder', async () => {
    const api = statusIs({ state: 'no-folder' }, { 'library.chooseFolder': READY });
    mount();

    expect(await screen.findByRole('heading', { name: 'Point me at your music' })).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Choose a folder' }));

    await waitFor(() => expect(api.invoke).toHaveBeenCalledWith('library.chooseFolder'));
    expect(await screen.findByText('The library')).toBeTruthy();
  });

  it('folder missing: says which one, and offers to retry or pick another', async () => {
    const api = statusIs(
      { state: 'folder-missing', folder: 'D:\\Music' },
      { 'library.retryOpen': READY, 'library.chooseFolder': READY },
    );
    mount();

    expect(await screen.findByRole('heading', { name: "Can't find your music" })).toBeTruthy();
    expect(screen.getByText(/D:\\Music isn't there right now/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Rebuild/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Restore/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(api.invoke).toHaveBeenCalledWith('library.retryOpen'));
    expect(await screen.findByText('The library')).toBeTruthy();
  });

  it('a retry that changes nothing still gets an answer', async () => {
    const missing: LibraryStatus = { state: 'folder-missing', folder: 'D:\\Music' };
    statusIs(missing, { 'library.retryOpen': missing });
    mount();

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));

    expect((await screen.findAllByText("That folder still isn't there")).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: "Can't find your music" })).toBeTruthy();
  });

  it('not writable: gives the reason from main', async () => {
    statusIs({ state: 'not-writable', folder: 'D:\\Music', message: 'This drive or folder is read-only.' });
    mount();

    expect(await screen.findByText(/This drive or folder is read-only/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose another folder' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Rebuild/ })).toBeNull();
  });

  it('corrupt with a backup: restoring comes first, and says how old it is and what it costs', async () => {
    const api = statusIs(CORRUPT, { 'library.restoreBackup': READY });
    mount();

    const restore = await screen.findByRole('button', { name: RESTORE });
    expect(screen.getAllByRole('button')[0]).toBe(restore);
    expect(screen.getByText(/Restoring goes back to Oct 29, 2026, so anything since then is lost/)).toBeTruthy();
    fireEvent.click(restore);

    await waitFor(() => expect(api.invoke).toHaveBeenCalledWith('library.restoreBackup'));
    expect(await screen.findByText('The library')).toBeTruthy();
  });

  it('corrupt with no backup: no restore on offer, and still a way out', async () => {
    statusIs({ ...CORRUPT, backupAt: null });
    mount();

    expect(await screen.findByRole('button', { name: 'Rebuild the library' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Restore/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Choose another folder' })).toBeTruthy();
  });

  describe('after a failed update', () => {
    const FAILED: LibraryStatus = { ...CORRUPT, cause: 'migration-failed' };

    it('rebuilding is what is on offer first, because the backup is the same database', async () => {
      statusIs(FAILED);
      mount();
      const rebuild = await screen.findByRole('button', { name: 'Rebuild the library' });
      expect(screen.getAllByRole('button')[0]).toBe(screen.getByRole('button', { name: RESTORE }));
      expect(rebuild.className).toContain('bg-accent');
      expect(screen.getByRole('button', { name: RESTORE }).className).not.toContain('bg-accent');
    });

    it('a restore that ends up in the same place says so', async () => {
      statusIs(FAILED, { 'library.restoreBackup': FAILED });
      mount();

      fireEvent.click(await screen.findByRole('button', { name: RESTORE }));

      expect((await screen.findAllByText("The library's database still can't be opened")).length).toBeGreaterThan(0);
    });
  });

  it.each([
    ['restoring', 'library.restoreBackup', RESTORE, null],
    ['rebuilding', 'library.rebuild', 'Rebuild the library', 'Rebuild and lose playlists'],
  ] as const)(
    '%s starts the navigation over, because the ids have changed',
    async (_name, command, button, confirm) => {
      act(() => openAlbum(57));
      statusIs(CORRUPT, { [command]: { ...READY, isEmpty: true } });
      mount();

      fireEvent.click(await screen.findByRole('button', { name: button }));
      if (confirm) fireEvent.click(await screen.findByRole('button', { name: confirm }));

      await screen.findByText('The library');
      const place = renderHook(() => useNavigation(currentPlace)).result.current;
      expect(place).toEqual({ kind: 'tab', tab: 'genres' });
    },
  );

  it('rebuilding warns about playlists first, and does nothing until told to', async () => {
    const api = statusIs(CORRUPT, { 'library.rebuild': { ...READY, isEmpty: true } });
    mount();

    fireEvent.click(await screen.findByRole('button', { name: 'Rebuild the library' }));

    const dialog = await screen.findByRole('dialog', { name: 'Rebuild the library?' });
    expect(dialog.textContent).toContain('Playlists');
    expect(api.invoke).not.toHaveBeenCalledWith('library.rebuild');

    fireEvent.click(screen.getByRole('button', { name: 'Keep it as it is' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.invoke).not.toHaveBeenCalledWith('library.rebuild');

    fireEvent.click(screen.getByRole('button', { name: 'Rebuild the library' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Rebuild and lose playlists' }));
    await waitFor(() => expect(api.invoke).toHaveBeenCalledWith('library.rebuild'));
    expect(await screen.findByText('The library')).toBeTruthy();
  });

  it('a failed action says why, and leaves the screen up', async () => {
    statusIs(CORRUPT, {
      'library.restoreBackup': { failure: 'no_backup', message: 'There is no usable backup to restore' },
    });
    mount();

    fireEvent.click(await screen.findByRole('button', { name: RESTORE }));

    expect((await screen.findAllByText('There is no usable backup to restore')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: RESTORE })).toBeTruthy();
  });

  it('too new: says so plainly, without touching the file, and offers the rest', async () => {
    statusIs({ state: 'db-too-new', folder: 'D:\\Music' });
    mount();

    expect(await screen.findByRole('heading', { name: 'This library is from a newer version' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose another folder' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rebuild the library' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Restore/ })).toBeNull();
  });

  it('when the status itself cannot be read, offers to ask again', async () => {
    const api = stubApi({ 'library.status': { failure: 'unexpected', message: 'Nope' } });
    mount();

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(api.invoke.mock.calls.filter(([name]) => name === 'library.status')).toHaveLength(2));
  });
});
