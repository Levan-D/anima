import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { useRescan } from '@/lib/libraryActions';
import { tracksQuery } from '@/lib/libraryQueries';
import { openPlace } from '@/lib/navigation';

const MISSING = { kind: 'missing' } as const;

/** For a list that's empty because nothing in the library is on this device: the files may be back, or be elsewhere. */
export function NothingHereActions() {
  const rescan = useRescan();
  const missing = useQuery(tracksQuery(MISSING));
  const hasMissing = (missing.data?.length ?? 0) > 0;

  return (
    <div className="flex flex-wrap justify-center gap-2">
      <Button variant="primary" loading={rescan.isPending} onClick={() => rescan.mutate()}>
        Rescan
      </Button>
      {hasMissing ? <Button onClick={() => openPlace(MISSING)}>Show what&apos;s missing</Button> : null}
    </div>
  );
}
