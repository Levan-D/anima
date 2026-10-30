import type { ReactNode } from 'react';
import { ErrorBoundary } from '@/app/ErrorBoundary';

type Props = {
  art: ReactNode;
  list: ReactNode;
  transport: ReactNode;
};

export function AppLayout({ art, list, transport }: Props) {
  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden side-by-side:flex-row">
      {/* Beside the art, the list column's own top row carries on from this one. */}
      <div
        aria-hidden
        data-testid="title-bar"
        className="absolute inset-x-0 top-0 z-10 h-title-bar drag side-by-side:right-auto side-by-side:w-(--art-side)"
      />

      <section
        aria-label="Album art"
        className="flex h-(--art-stacked) shrink-0 justify-center side-by-side:h-full side-by-side:w-(--art-side) side-by-side:items-center"
      >
        <div
          data-testid="art"
          className="aspect-square h-full min-h-0 min-w-0 overflow-hidden side-by-side:h-auto side-by-side:w-full"
        >
          <ErrorBoundary>{art}</ErrorBoundary>
        </div>
      </section>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-linear-to-b from-accent-wash to-transparent to-40%">
        <main className="flex min-h-0 flex-1 flex-col">
          <ErrorBoundary>{list}</ErrorBoundary>
        </main>
        <footer className="h-transport shrink-0">
          <ErrorBoundary>{transport}</ErrorBoundary>
        </footer>
      </div>
    </div>
  );
}
