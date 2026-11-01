import type { ComponentType } from 'react';
import { ErrorBoundary } from '@/app/ErrorBoundary';
import { PageBar } from '@/app/PageBar';
import { DiscoverPage } from '@/app/pages/DiscoverPage';
import { LibraryPage } from '@/app/pages/LibraryPage';
import { RadioPage } from '@/app/pages/RadioPage';
import { Equalizer } from '@/features/Equalizer/Equalizer';
import { Settings } from '@/features/Settings/Settings';
import { usePage, type Page } from '@/lib/pages';
import { useBackKeys } from '@/lib/useBackKeys';

const PAGE_VIEWS: Record<Page, ComponentType> = {
  library: LibraryPage,
  radio: RadioPage,
  discover: DiscoverPage,
};

/** The page that's showing, and what's the same on all of them. A new page is a line in lib/pages and one here. */
export function Pages() {
  useBackKeys();
  const View = PAGE_VIEWS[usePage()];

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <View />
      <PageBar />
      <ErrorBoundary fallback={null}>
        <Settings />
      </ErrorBoundary>
      <ErrorBoundary fallback={null}>
        <Equalizer />
      </ErrorBoundary>
    </div>
  );
}
