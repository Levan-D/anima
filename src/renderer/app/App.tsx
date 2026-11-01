import { ErrorBoundary } from '@/app/ErrorBoundary';
import { Pages } from '@/app/Pages';
import { AppProviders, MiniProviders } from '@/app/providers/AppProviders';
import { isMiniWindow } from '@/app/windowRoute';
import { Hotkeys } from '@/features/Hotkeys/Hotkeys';
import { LibraryGate } from '@/features/LibraryGate/LibraryGate';
import { MediaSession } from '@/features/MediaSession/MediaSession';
import { MiniPlayer } from '@/features/MiniPlayer/MiniPlayer';
import { MiniQueue } from '@/features/Queue/MiniQueue';
import { useLibrarySync } from '@/lib/useLibrarySync';
import { useNoticeToasts } from '@/lib/useNoticeToasts';

// Beside the layout rather than above it, so a status change on every scan commit doesn't re-render all of it.
function Subscriptions() {
  useLibrarySync();
  useNoticeToasts();
  return null;
}

function MainWindow() {
  return (
    <ErrorBoundary>
      <AppProviders>
        <Subscriptions />
        <ErrorBoundary fallback={null}>
          <MediaSession />
        </ErrorBoundary>
        <Hotkeys windowKind="main" />
        <LibraryGate>
          <Pages />
        </LibraryGate>
      </AppProviders>
    </ErrorBoundary>
  );
}

function MiniWindow() {
  return (
    <ErrorBoundary>
      <MiniProviders>
        <Hotkeys windowKind="mini" />
        <MiniPlayer queue={<MiniQueue />} />
      </MiniProviders>
    </ErrorBoundary>
  );
}

export function App() {
  return isMiniWindow() ? <MiniWindow /> : <MainWindow />;
}
