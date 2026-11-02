import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';

type Props = {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
};

/** Are you sure, for something that can't be undone. Mount it to ask. */
export function ConfirmDialog({ title, description, confirmLabel, onConfirm, onClose }: Props) {
  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      title={title}
      description={description}
      actions={[
        <Button key="cancel" variant="outline" size="md" autoFocus>
          Cancel
        </Button>,
        <Button key="confirm" variant="danger" size="md" onClick={onConfirm}>
          {confirmLabel}
        </Button>,
      ]}
    />
  );
}
