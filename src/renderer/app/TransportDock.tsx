import { ErrorBoundary } from '@/app/ErrorBoundary';
import { QueueSheet } from '@/features/Queue/QueueSheet';
import { Transport } from '@/features/Transport/Transport';

/** The transport and the sheet that rises out of it. Whatever holds this has to be positioned, and sets both their widths. */
export function TransportDock() {
  return (
    <>
      <Transport />
      <ErrorBoundary fallback={null}>
        <QueueSheet />
      </ErrorBoundary>
    </>
  );
}
