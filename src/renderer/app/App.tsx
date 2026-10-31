import { AppLayout } from '@/app/AppLayout';
import { ErrorBoundary } from '@/app/ErrorBoundary';
import { ListColumn } from '@/app/ListColumn';
import { AppProviders } from '@/app/providers/AppProviders';
import { isMiniWindow } from '@/app/windowRoute';
import { Hotkeys } from '@/features/Hotkeys/Hotkeys';
import { LibraryGate } from '@/features/LibraryGate/LibraryGate';
import { MediaSession } from '@/features/MediaSession/MediaSession';
import { MiniPlayer } from '@/features/MiniPlayer/MiniPlayer';
import { NowPlaying } from '@/features/NowPlaying/NowPlaying';
import { Transport } from '@/features/Transport/Transport';
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
          <AppLayout art={<NowPlaying />} list={<ListColumn />} transport={<Transport />} />
        </LibraryGate>
      </AppProviders>
    </ErrorBoundary>
  );
}

function MiniWindow() {
  return (
    <ErrorBoundary>
      <Hotkeys windowKind="mini" />
      <MiniPlayer />
    </ErrorBoundary>
  );
}

export function App() {
  return isMiniWindow() ? <MiniWindow /> : <MainWindow />;
}
