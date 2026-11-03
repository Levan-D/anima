import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { StorageInfo } from '@shared/domain';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { VerticalTabs } from '@/components/ui/VerticalTabs';
import { DataTab } from '@/features/Settings/components/DataTab';
import { InterfaceSizeSection } from '@/features/Settings/components/InterfaceSizeSection';
import { LibrarySection } from '@/features/Settings/components/LibrarySection';
import { LyricsSection } from '@/features/Settings/components/LyricsSection';
import { MissingSection } from '@/features/Settings/components/MissingSection';
import { PlaybackSection } from '@/features/Settings/components/PlaybackSection';
import { ReportTab } from '@/features/Settings/components/ReportTab';
import { SeasonsTab } from '@/features/Settings/components/SeasonsTab';
import { StatsTab } from '@/features/Settings/components/StatsTab';
import { StorageSection } from '@/features/Settings/components/StorageSection';
import { useSettingsFocus } from '@/features/Settings/hooks/useSettingsFocus';
import { storageQuery } from '@/lib/libraryQueries';
import { chooseSettingsTab, SETTINGS_TABS, useSettingsTab, type SettingsTab } from '@/lib/pages';

function PaneSkeleton() {
  return (
    <div aria-hidden className="flex animate-appear-late flex-col gap-section pt-section">
      <Skeleton className="h-6 w-2/5" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

type StoragePaneProps = {
  children: (storage: StorageInfo) => ReactNode;
};

/** What's on disk, which the Library tab shows. */
function StoragePane({ children }: StoragePaneProps) {
  const storage = useQuery(storageQuery);

  if (storage.isPending) return <PaneSkeleton />;
  if (storage.isError) return <ErrorState error={storage.error} onRetry={() => void storage.refetch()} />;
  return <div className="content-in flex flex-col">{children(storage.data)}</div>;
}

const PANES: Record<SettingsTab, { label: string; content: ReactNode; isList?: boolean }> = {
  general: {
    label: 'General',
    content: (
      <>
        <PlaybackSection />
        <InterfaceSizeSection />
      </>
    ),
  },
  library: {
    label: 'Library',
    content: (
      <StoragePane>
        {(storage) => (
          <div className="flex flex-col">
            <LibrarySection storage={storage} />
            <MissingSection missing={storage.counts.missing} />
            <StorageSection storage={storage} />
          </div>
        )}
      </StoragePane>
    ),
  },
  report: { label: 'Library report', content: <ReportTab />, isList: true },
  seasons: { label: 'Seasons', content: <SeasonsTab /> },
  // Everything that runs long or asks a service on the internet, so what leaves this PC is all in one place.
  data: {
    label: 'Online and data',
    content: (
      <>
        <DataTab />
        <LyricsSection />
      </>
    ),
  },
  stats: { label: 'Stats', content: <StatsTab /> },
};

// The page has the whole window, and a form across a 4K screen is hard to read along. A list scrolls by itself.
const TAB_ITEMS = SETTINGS_TABS.map((value) => ({
  value,
  label: PANES[value].label,
  content: (
    <div
      className={
        PANES[value].isList
          ? 'mx-auto flex min-h-0 w-full max-w-280 flex-1 flex-col'
          : 'mx-auto flex w-full max-w-280 shrink-0 grow flex-col'
      }
    >
      {PANES[value].content}
    </div>
  ),
}));

function onTabChosen(value: string): void {
  const tab = SETTINGS_TABS.find((candidate) => candidate === value);
  if (tab) chooseSettingsTab(tab);
}

export function Settings() {
  const tab = useSettingsTab();
  const pageRef = useSettingsFocus();

  return (
    <div ref={pageRef} data-testid="settings" className="flex min-h-0 flex-1 flex-col">
      <VerticalTabs label="Settings" items={TAB_ITEMS} value={tab} onValueChange={onTabChosen} />
    </div>
  );
}
