import type { ReactNode } from 'react';
import { ErrorBoundary } from '@/app/ErrorBoundary';
import { QueueSheet } from '@/features/Queue/QueueSheet';
import { Transport } from '@/features/Transport/Transport';

type Props = {
  /** A page's own button on the transport. */
  action?: ReactNode;
};

/** The transport and the sheet that rises out of it. Whatever holds this has to be positioned, and sets both their widths. */
export function TransportDock({ action }: Props) {
  return (
    <>
      <Transport action={action} />
      <ErrorBoundary fallback={null}>
        <QueueSheet />
      </ErrorBoundary>
    </>
  );
}
