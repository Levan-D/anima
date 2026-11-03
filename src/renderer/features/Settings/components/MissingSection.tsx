import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { ModalSection } from '@/components/ui/ModalSection';
import { Text } from '@/components/ui/Text';
import { formatPlural } from '@/lib/format';
import { useRemoveMissing } from '@/lib/libraryActions';
import { useIsScanning } from '@/lib/libraryQueries';
import { openPlace } from '@/lib/navigation';

type Props = {
  missing: number;
};

export function MissingSection({ missing }: Props) {
  const remove = useRemoveMissing();
  const isScanning = useIsScanning();

  if (missing === 0) {
    return (
      <ModalSection title="Missing files">
        <Text as="p" color="muted">
          Every song in the library is in the folder
        </Text>
      </ModalSection>
    );
  }

  const count = formatPlural(missing, 'track');

  return (
    <ModalSection title="Missing files">
      <Text as="p">
        {missing === 1
          ? `${count} in the library isn't in the folder anymore, because it was moved, deleted or is on a drive that's not plugged in. It stays greyed out in playlists, and comes back by itself on the next rescan that finds it.`
          : `${count} in the library aren't in the folder anymore, because they were moved, deleted or are on a drive that's not plugged in. They stay greyed out in playlists, and come back by themselves on the next rescan that finds them.`}
      </Text>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="md"
          onClick={() => {
            openPlace({ kind: 'missing' });
          }}
        >
          Show them
        </Button>
        <Dialog
          trigger={
            <Button variant="danger" size="md" loading={remove.isPending} disabled={isScanning}>
              Remove missing
            </Button>
          }
          title={`Remove ${count} from the library?`}
          description="They also come out of every playlist they're in, and their stats go with them. Your files aren't touched."
          actions={[
            <Button key="cancel" variant="outline">
              Keep them
            </Button>,
            <Button key="remove" variant="danger" onClick={() => remove.mutate()}>
              Remove them
            </Button>,
          ]}
        />
      </div>
    </ModalSection>
  );
}
