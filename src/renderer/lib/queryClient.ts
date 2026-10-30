import { QueryClient } from '@tanstack/react-query';

// Local data: it never goes offline, and it only changes when main says so through an invalidation.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { networkMode: 'always', retry: false, staleTime: Infinity },
    mutations: { networkMode: 'always', retry: false },
  },
});
