import type { ReactNode } from 'react';
import { ErrorBoundary } from '@/app/ErrorBoundary';

type Props = {
  children: ReactNode;
  transport: ReactNode;
};

/** A page with no art, which has the window's whole width. The `page` container is what lays the transport flat. */
export function WideLayout({ children, transport }: Props) {
  return (
    <div className="flex size-full flex-col bg-linear-to-b from-accent-wash to-transparent to-40% pt-page-bar">
      <main className="relative flex min-h-0 flex-1 flex-col">
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>
      <footer className="@container/page shrink-0">
        <ErrorBoundary>{transport}</ErrorBoundary>
      </footer>
    </div>
  );
}
