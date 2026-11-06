import type { ComponentType } from 'react';
import { ErrorBoundary } from '@/app/ErrorBoundary';
import { PageBar } from '@/app/PageBar';
import { DiscoverPage } from '@/app/pages/DiscoverPage';
import { LibraryPage } from '@/app/pages/LibraryPage';
import { RadioPage } from '@/app/pages/RadioPage';
import { SettingsPage } from '@/app/pages/SettingsPage';
import { Equalizer } from '@/features/Equalizer/Equalizer';
import { useClosesSettingsWithThePages, usePage, type Page } from '@/lib/pages';
import { useBackKeys } from '@/lib/useBackKeys';
import { useRadioNotice } from '@/lib/useRadioNotice';

const PAGE_VIEWS: Record<Page, ComponentType> = {
  library: LibraryPage,
  radio: RadioPage,
  discover: DiscoverPage,
  settings: SettingsPage,
};

/** The page that's showing, and what's the same on all of them. A new page is a line in lib/pages, one in PageBar's tabs and one here. */
export function Pages() {
  useBackKeys();
  useRadioNotice();
  useClosesSettingsWithThePages();
  const View = PAGE_VIEWS[usePage()];

  return (
    <div className="content-in relative h-screen w-screen overflow-hidden">
      <View />
      <PageBar />
      <ErrorBoundary fallback={null}>
        <Equalizer />
      </ErrorBoundary>
    </div>
  );
}
