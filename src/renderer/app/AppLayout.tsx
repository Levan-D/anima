import type { ReactNode } from 'react';
import { ErrorBoundary } from '@/app/ErrorBoundary';
import { AlbumBackdrop } from '@/components/music/AlbumBackdrop';

type Props = {
  art: ReactNode;
  /** Over the art, and only as big as it. */
  overlay: ReactNode;
  list: ReactNode;
  transport: ReactNode;
};

/** Light tones behind rows, not a picture. */
const LIST_WASH = 0.22;

export function AppLayout({ art, overlay, list, transport }: Props) {
  return (
    <div className="flex size-full flex-col pt-page-bar lg:flex-row lg:pt-0">
      <section
        aria-label="Album art"
        className="hidden shrink-0 justify-center lg:flex lg:h-full lg:w-(--art-side) lg:items-center"
      >
        <div
          data-testid="art"
          className="relative aspect-square h-full min-h-0 min-w-0 overflow-hidden lg:h-auto lg:w-full"
        >
          <ErrorBoundary>{art}</ErrorBoundary>
          <div className="pointer-events-none absolute inset-0 *:pointer-events-auto">
            <ErrorBoundary>{overlay}</ErrorBoundary>
          </div>
        </div>
      </section>

      <div className="@container/column relative isolate flex min-h-0 min-w-0 flex-1 flex-col lg:pt-page-bar">
        <AlbumBackdrop intensity={LIST_WASH} className="absolute inset-0" />
        <main className="flex min-h-0 flex-1 flex-col">
          <ErrorBoundary>{list}</ErrorBoundary>
        </main>
        <footer className="pointer-events-auto relative min-h-transport shrink-0 @max-md/column:min-h-0">
          <ErrorBoundary>{transport}</ErrorBoundary>
        </footer>
      </div>
    </div>
  );
}
