import type { LibraryStatus } from '@shared/domain';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { GateScreen } from '@/features/LibraryGate/components/GateScreen';
import { formatDay } from '@/lib/format';
import { useChooseFolder, useRebuild, useRestoreBackup, useRetryOpen } from '@/lib/libraryActions';

type Problem = Exclude<LibraryStatus, { state: 'ready' } | { state: 'no-folder' }>;

type Props = {
  status: Problem;
};

function explain(status: Problem): { title: string; description: string } {
  switch (status.state) {
    case 'folder-missing':
      return {
        title: "Can't find your music",
        description: `${status.folder} isn't there right now. If it's on a drive, plug it back in and try again.`,
      };
    case 'not-writable':
      return {
        title: "Can't save anything in this folder",
        description: `The library's database lives in ${status.folder}. ${status.message}`,
      };
    case 'db-corrupt':
      return {
        title: "The library's database can't be opened",
        description:
          status.backupAt === null
            ? status.message
            : `${status.message} Restoring goes back to ${formatDay(status.backupAt)}, so anything since then is lost, and the file that's there now is kept.`,
      };
    case 'db-too-new':
      return {
        title: 'This library is from a newer version',
        description: `The database for ${status.folder} was last saved by a newer version of the app, so it was left alone. Update the app on this machine to open it.`,
      };
  }
}

type RebuildProps = {
  variant: 'primary' | 'secondary';
};

function RebuildButton({ variant }: RebuildProps) {
  const rebuild = useRebuild();

  return (
    <Dialog
      trigger={
        <Button variant={variant} loading={rebuild.isPending}>
          Rebuild the library
        </Button>
      }
      title="Rebuild the library?"
      description="The folder gets scanned again from nothing. Playlists, listening stats and fetched lyrics won't carry over. The old database is kept beside the new one, and your music files aren't touched."
      actions={[
        <Button key="cancel" variant="outline">
          Keep it as it is
        </Button>,
        <Button key="rebuild" variant="danger" onClick={() => rebuild.mutate()}>
          Rebuild and lose playlists
        </Button>,
      ]}
    />
  );
}

type RestoreProps = {
  backupAt: number | null;
  isLooking: boolean;
  leads: boolean;
};

/** Where Restore goes, held by a button that's busy while the backups are checked, so nothing jumps when it's known. */
function RestoreButton({ backupAt, isLooking, leads }: RestoreProps) {
  const restore = useRestoreBackup();
  if (isLooking) {
    return (
      <Button variant={leads ? 'primary' : 'secondary'} loading>
        Looking for a backup
      </Button>
    );
  }
  if (backupAt === null) return null;
  return (
    <Button variant={leads ? 'primary' : 'secondary'} loading={restore.isPending} onClick={() => restore.mutate()}>
      Restore the backup from {formatDay(backupAt)}
    </Button>
  );
}

export function LibraryProblem({ status }: Props) {
  const retry = useRetryOpen();
  const chooseFolder = useChooseFolder();
  const { title, description } = explain(status);

  const canRebuild = status.state === 'db-corrupt' || status.state === 'db-too-new';
  const backupAt = status.state === 'db-corrupt' ? status.backupAt : null;
  const isLooking = status.state === 'db-corrupt' && status.isLookingForBackup;
  // A failed update made its backup from the same database, so restoring it just fails the same way.
  const rebuildIsTheWayOut = status.state === 'db-corrupt' && status.cause === 'migration-failed';
  const restoreLeads = (isLooking || backupAt !== null) && !rebuildIsTheWayOut;

  return (
    <GateScreen title={title} description={description}>
      <RestoreButton backupAt={backupAt} isLooking={isLooking} leads={restoreLeads} />
      {canRebuild ? <RebuildButton variant={rebuildIsTheWayOut ? 'primary' : 'secondary'} /> : null}
      <Button variant={canRebuild ? 'ghost' : 'primary'} loading={retry.isPending} onClick={() => retry.mutate()}>
        Try again
      </Button>
      <Button variant={canRebuild ? 'ghost' : 'secondary'} onClick={() => chooseFolder.mutate()}>
        Choose another folder
      </Button>
    </GateScreen>
  );
}
