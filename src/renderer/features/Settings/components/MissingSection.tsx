import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { ModalSection } from '@/components/ui/ModalSection';
import { Text } from '@/components/ui/Text';
import { formatPlural } from '@/lib/format';
import { useRemoveMissing } from '@/lib/libraryActions';
import { useIsScanning } from '@/lib/libraryQueries';
import { openPlace } from '@/lib/navigation';
import { closeSettings } from '@/lib/settingsDialog';

type Props = {
  missing: number;
};

export function MissingSection({ missing }: Props) {
  const remove = useRemoveMissing();
  const isScanning = useIsScanning();

  if (missing === 0) {
    return (
      <ModalSection title="Missing">
        <Text as="p" color="muted">
          Everything in the library is on this device
        </Text>
      </ModalSection>
    );
  }

  const count = formatPlural(missing, 'track');

  return (
    <ModalSection title="Missing">
      <Text as="p">
        {missing === 1
          ? `${count} in the library isn't on this device. It comes back by itself if the file returns.`
          : `${count} in the library aren't on this device. They come back by themselves if the files return.`}
      </Text>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => {
            closeSettings();
            openPlace({ kind: 'missing' });
          }}
        >
          Show them
        </Button>
        <Dialog
          trigger={
            <Button variant="danger" loading={remove.isPending} disabled={isScanning}>
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
