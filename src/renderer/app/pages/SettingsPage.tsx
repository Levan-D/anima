import { ErrorBoundary } from '@/app/ErrorBoundary';
import { Settings } from '@/features/Settings/Settings';

/** No art and no music controls, so the forms have the whole window. Hotkeys and media keys don't live in the page. */
export function SettingsPage() {
  return (
    <main className="flex size-full flex-col bg-linear-to-b from-accent-wash to-transparent to-40% pt-page-bar">
      <ErrorBoundary>
        <Settings />
      </ErrorBoundary>
    </main>
  );
}
