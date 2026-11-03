import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';

type Props = {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  /** Off for something long rather than something lost, which gets a plain button. */
  isDanger?: boolean;
};

/** Are you sure, for something that can't be undone or takes a while. Mount it to ask. */
export function ConfirmDialog({ title, description, confirmLabel, onConfirm, onClose, isDanger = true }: Props) {
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
        <Button key="confirm" variant={isDanger ? 'danger' : 'primary'} size="md" onClick={onConfirm}>
          {confirmLabel}
        </Button>,
      ]}
    />
  );
}
