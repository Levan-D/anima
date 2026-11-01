import type { ReactNode } from 'react';
import { ErrorBoundary } from '@/app/ErrorBoundary';

type Props = {
  children: ReactNode;
  transport: ReactNode;
};

/**
 * A page with no art, which has the window's whole width. The content runs the full height, and the transport floats over
 * it in a centered column, so whatever's in the page has to leave `island-clear` at its end.
 */
export function WideLayout({ children, transport }: Props) {
  return (
    <div className="relative flex size-full flex-col bg-linear-to-b from-accent-wash to-transparent to-40% pt-page-bar">
      <main className="relative flex min-h-0 flex-1 flex-col">
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>
      <footer className="pointer-events-none absolute inset-x-0 bottom-gap z-20 flex justify-center px-gap">
        <div className="pointer-events-auto relative w-full max-w-transport-column min-w-0 rounded-lg bg-surface-raised shadow-2xl [&>section]:before:hidden">
          <ErrorBoundary>{transport}</ErrorBoundary>
        </div>
      </footer>
    </div>
  );
}
