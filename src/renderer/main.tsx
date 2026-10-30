import '@/styles/globals.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import { reportError } from '@/lib/reportError';
import { startUiScaleSync } from '@/lib/uiScale';
import { startWindowVisibilitySync } from '@/lib/windowVisibility';

function reportReactError(error: unknown, info: { componentStack?: string | undefined }): void {
  reportError(error, info.componentStack ?? null);
}

window.addEventListener('error', (event) => reportError(event.error ?? event.message));
window.addEventListener('unhandledrejection', (event) => reportError(event.reason));

startWindowVisibilitySync();

const container = document.getElementById('root');
if (!container) throw new Error('index.html has no #root element');

const root = createRoot(container, {
  onUncaughtError: reportReactError,
  onCaughtError: reportReactError,
  onRecoverableError: reportReactError,
});

// Waits for the interface size, so the first paint isn't at the wrong one.
void startUiScaleSync().finally(() =>
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
