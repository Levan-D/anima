import { QueryClient } from '@tanstack/react-query';

// Local data: it never goes offline, and it only changes when main says so through an invalidation.
// Kept for good, so going back to a list shows it at once. The whole library is a few megabytes.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { networkMode: 'always', retry: false, staleTime: Infinity, gcTime: Infinity },
    mutations: { networkMode: 'always', retry: false },
  },
});
