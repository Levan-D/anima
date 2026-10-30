import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { useChooseFolder, useRescan } from '@/lib/libraryActions';
import { scanQuery, statusQuery } from '@/lib/libraryQueries';

export function NoMusic() {
  const rescan = useRescan();
  const chooseFolder = useChooseFolder();
  const { data: folder = null } = useQuery({
    ...statusQuery,
    select: (status) => (status.state === 'ready' ? status.folder : null),
  });
  // Cancelling a first scan leaves this screen up too, and then it hasn't looked at everything.
  const { data: wasCancelled = false } = useQuery({
    ...scanQuery,
    select: ({ lastReport }) => lastReport?.cancelled ?? false,
  });

  return (
    <EmptyState
      title={wasCancelled ? 'The scan was cancelled before it found anything' : 'No music found in this folder'}
      {...(wasCancelled || folder === null ? {} : { description: `Looked in ${folder} for FLAC, MP3 and other audio` })}
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="primary" loading={rescan.isPending} onClick={() => rescan.mutate()}>
            Rescan
          </Button>
          <Button onClick={() => chooseFolder.mutate()}>Change folder</Button>
        </div>
      }
    />
  );
}
