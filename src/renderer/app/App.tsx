import { AppLayout } from '@/app/AppLayout';
import { ErrorBoundary } from '@/app/ErrorBoundary';
import { ArtPlaceholder } from '@/app/placeholders/ArtPlaceholder';
import { ListPlaceholder } from '@/app/placeholders/ListPlaceholder';
import { TransportPlaceholder } from '@/app/placeholders/TransportPlaceholder';
import { AppProviders } from '@/app/providers/AppProviders';

export function App() {
  return (
    <ErrorBoundary>
      <AppProviders>
        <AppLayout art={<ArtPlaceholder />} list={<ListPlaceholder />} transport={<TransportPlaceholder />} />
      </AppProviders>
    </ErrorBoundary>
  );
}
