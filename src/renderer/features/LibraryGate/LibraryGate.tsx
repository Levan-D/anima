import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { GateScreen } from '@/features/LibraryGate/components/GateScreen';
import { LibraryProblem } from '@/features/LibraryGate/components/LibraryProblem';
import { NoFolder } from '@/features/LibraryGate/components/NoFolder';
import { statusQuery } from '@/lib/libraryQueries';

type Props = {
  /** What fills the window once the library is open. */
  children: ReactNode;
};

/** Decides what fills the window: the library, or the one thing standing between it and you. */
export function LibraryGate({ children }: Props) {
  const status = useQuery(statusQuery);

  // Main opens the library before the window, so this is over in a moment. A blank window is calmer than a flash.
  if (status.isPending) return <GateScreen />;
  if (status.isError) {
    return (
      <GateScreen title="The library didn't answer" description="Something went wrong asking for it.">
        <Button variant="primary" onClick={() => void status.refetch()}>
          Try again
        </Button>
      </GateScreen>
    );
  }
  if (status.data.state === 'no-folder') return <NoFolder />;
  if (status.data.state !== 'ready') return <LibraryProblem status={status.data} />;
  return children;
}
