import { QueryClientProvider } from '@tanstack/react-query';
import { render, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { queryClient } from '@/lib/queryClient';
import { READY, stubApi } from '@/lib/testing';
import { useToasts } from '@/lib/toastStore';
import { useLibrarySync } from '@/lib/useLibrarySync';

function Sync() {
  useLibrarySync();
  return null;
}

// In a file of its own, because "once per launch" is kept in the module, and vitest gives each file a fresh one.
describe('a library last changed on another machine', () => {
  it('says which machine, once per launch', async () => {
    stubApi({
      'library.status': {
        ...READY,
        changedElsewhere: true,
        lastChanged: { host: 'THE-MAIN-MACHINE', at: 1_700_000_000_000 },
      },
    });

    const first = render(
      <QueryClientProvider client={queryClient}>
        <Sync />
      </QueryClientProvider>,
    );
    const toasts = renderHook(() => useToasts()).result;
    const notes = () => toasts.current.filter(({ message }) => message.includes('THE-MAIN-MACHINE'));
    await waitFor(() => expect(notes()).toHaveLength(1));
    expect(notes()[0]?.message).toContain('Library last changed on THE-MAIN-MACHINE');
    first.unmount();

    queryClient.clear();
    render(
      <QueryClientProvider client={queryClient}>
        <Sync />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(queryClient.getQueryData(['status'])).toBeTruthy());

    expect(notes()).toHaveLength(1);
  });
});
