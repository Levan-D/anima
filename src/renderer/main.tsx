import '@/styles/globals.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import { startAlbumAccentSync } from '@/lib/albumAccent';
import { startPlayerPositionSync } from '@/lib/playerPosition';
import { startPlayerSync } from '@/lib/playerStore';
import { reportError } from '@/lib/reportError';
import { startUiScaleSync } from '@/lib/uiScale';
import { startWindowVisibilitySync } from '@/lib/windowVisibility';

function reportReactError(error: unknown, info: { componentStack?: string | undefined }): void {
  reportError(error, info.componentStack ?? null);
}

window.addEventListener('error', (event) => reportError(event.error ?? event.message));
window.addEventListener('unhandledrejection', (event) => reportError(event.reason));

startWindowVisibilitySync();
startPlayerPositionSync();
startAlbumAccentSync();

const container = document.getElementById('root');
if (!container) throw new Error('index.html has no #root element');

const root = createRoot(container, {
  onUncaughtError: reportReactError,
  onCaughtError: reportReactError,
  onRecoverableError: reportReactError,
});

// Waits for the interface size and the player, so the first paint isn't at the wrong size, or idle in the middle of a song.
void Promise.allSettled([startUiScaleSync(), startPlayerSync()]).finally(() =>
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
