import { AppLayout } from '@/app/AppLayout';
import { ErrorBoundary } from '@/app/ErrorBoundary';
import { ListColumn } from '@/app/ListColumn';
import { ArtPlaceholder } from '@/app/placeholders/ArtPlaceholder';
import { TransportPlaceholder } from '@/app/placeholders/TransportPlaceholder';
import { AppProviders } from '@/app/providers/AppProviders';
import { LibraryGate } from '@/features/LibraryGate/LibraryGate';
import { useLibrarySync } from '@/lib/useLibrarySync';
import { useNoticeToasts } from '@/lib/useNoticeToasts';

// Beside the layout rather than above it, so a status change on every scan commit doesn't re-render all of it.
function Subscriptions() {
  useLibrarySync();
  useNoticeToasts();
  return null;
}

export function App() {
  return (
    <ErrorBoundary>
      <AppProviders>
        <Subscriptions />
        <LibraryGate>
          <AppLayout art={<ArtPlaceholder />} list={<ListColumn />} transport={<TransportPlaceholder />} />
        </LibraryGate>
      </AppProviders>
    </ErrorBoundary>
  );
}
