import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { queueQuery } from '@/lib/playerQueries';
import { usePlayer } from '@/lib/playerStore';

/** What's coming up. Main holds it, and says when it has changed by moving on to a new version. */
export function useQueue() {
  const version = usePlayer((state) => state.queueVersion);
  return useQuery({ ...queueQuery(version), placeholderData: keepPreviousData });
}
