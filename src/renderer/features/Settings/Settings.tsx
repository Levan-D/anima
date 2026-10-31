import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { StorageInfo } from '@shared/domain';
import { ErrorState } from '@/components/ui/ErrorState';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';
import { VerticalTabs } from '@/components/ui/VerticalTabs';
import { InterfaceSizeSection } from '@/features/Settings/components/InterfaceSizeSection';
import { LibrarySection } from '@/features/Settings/components/LibrarySection';
import { LyricsSection } from '@/features/Settings/components/LyricsSection';
import { MissingSection } from '@/features/Settings/components/MissingSection';
import { PlaybackSection } from '@/features/Settings/components/PlaybackSection';
import { StatsTab } from '@/features/Settings/components/StatsTab';
import { StorageSection } from '@/features/Settings/components/StorageSection';
import { useClosesWithTheList } from '@/features/Settings/hooks/useClosesWithTheList';
import { storageQuery } from '@/lib/libraryQueries';
import {
  chooseSettingsTab,
  closeSettings,
  openSettings,
  SETTINGS_TABS,
  useSettingsDialog,
  type SettingsTab,
} from '@/lib/settingsDialog';

function PaneSkeleton() {
  return (
    <div aria-hidden className="flex animate-appear-late flex-col gap-section pt-gap">
      <Skeleton className="h-6 w-2/5" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

type StoragePaneProps = {
  children: (storage: StorageInfo) => ReactNode;
};

/** The two tabs that show what's on disk. */
function StoragePane({ children }: StoragePaneProps) {
  const storage = useQuery(storageQuery);

  if (storage.isPending) return <PaneSkeleton />;
  if (storage.isError) return <ErrorState error={storage.error} onRetry={() => void storage.refetch()} />;
  return children(storage.data);
}

const PANES: Record<SettingsTab, { label: string; content: ReactNode }> = {
  playback: { label: 'Playback', content: <PlaybackSection /> },
  interface: { label: 'Interface', content: <InterfaceSizeSection /> },
  library: {
    label: 'Library',
    content: (
      <StoragePane>
        {(storage) => (
          <div className="flex flex-col gap-section">
            <LibrarySection storage={storage} />
            <MissingSection missing={storage.counts.missing} />
          </div>
        )}
      </StoragePane>
    ),
  },
  lyrics: { label: 'Lyrics', content: <LyricsSection /> },
  storage: {
    label: 'Storage',
    content: <StoragePane>{(storage) => <StorageSection storage={storage} />}</StoragePane>,
  },
  stats: { label: 'Stats', content: <StatsTab /> },
};

const TAB_ITEMS = SETTINGS_TABS.map((value) => ({ value, ...PANES[value] }));

function onTabChosen(value: string): void {
  const tab = SETTINGS_TABS.find((candidate) => candidate === value);
  if (tab) chooseSettingsTab(tab);
}

// So the arrows work straight away, and a keyboard starts where it was.
function focusTheActiveTab(event: Event): void {
  if (!(event.currentTarget instanceof Element)) return;
  const active = event.currentTarget.querySelector('[role="tab"][data-state="active"]');
  if (!(active instanceof HTMLElement)) return;
  event.preventDefault();
  active.focus();
}

export function Settings() {
  const isOpen = useSettingsDialog((state) => state.isOpen);
  const tab = useSettingsDialog((state) => state.tab);
  useClosesWithTheList();

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => {
        if (open) openSettings();
        else closeSettings();
      }}
      title="Settings"
      closeLabel="Close settings"
      size="lg"
      onOpenAutoFocus={focusTheActiveTab}
    >
      <div data-testid="settings" className="flex min-h-0 flex-1 flex-col">
        <VerticalTabs label="Settings" items={TAB_ITEMS} value={tab} onValueChange={onTabChosen} />
      </div>
    </Modal>
  );
}
