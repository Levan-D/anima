import { Dialog as RadixDialog } from 'radix-ui';
import { Children, type ReactElement } from 'react';
import { Divider } from '@/components/ui/Divider';
import { Modal, type ModalProps } from '@/components/ui/Modal';

type Props = Omit<ModalProps, 'size' | 'closeLabel' | 'onOpenAutoFocus'> & {
  /** Using one closes the dialog, unless its onClick calls preventDefault. */
  actions?: ReactElement | ReactElement[];
};

/** A small Modal with something to say and buttons to answer it. */
export function Dialog({ actions, children, ...modalProps }: Props) {
  return (
    <Modal {...modalProps}>
      {children === undefined ? null : (
        <div className="flex min-h-0 flex-col gap-gap overflow-y-auto p-section">{children}</div>
      )}
      {children !== undefined && actions ? <Divider /> : null}
      {actions ? (
        <div className="flex shrink-0 flex-wrap justify-end gap-2 p-section">
          {Children.map(actions, (action) => (
            <RadixDialog.Close asChild>{action}</RadixDialog.Close>
          ))}
        </div>
      ) : null}
    </Modal>
  );
}
