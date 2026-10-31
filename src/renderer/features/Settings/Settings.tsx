import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { Text } from '@/components/ui/Text';
import { InterfaceSizeSection } from '@/features/Settings/components/InterfaceSizeSection';
import { LibrarySection } from '@/features/Settings/components/LibrarySection';
import { MissingSection } from '@/features/Settings/components/MissingSection';
import { PlaybackSection } from '@/features/Settings/components/PlaybackSection';
import { StorageSection } from '@/features/Settings/components/StorageSection';
import { storageQuery } from '@/lib/libraryQueries';
import { recallList, rememberScroll } from '@/lib/listMemory';
import { placeKey } from '@/lib/navigation';

function SettingsSkeleton() {
  return (
    <div aria-hidden className="flex animate-appear-late flex-col gap-section p-gutter">
      <Skeleton className="h-6 w-2/5" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-6 w-2/5" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

const SETTINGS = placeKey({ kind: 'settings' });

function backToWhereItWas(scroller: HTMLElement | null): void {
  if (scroller) scroller.scrollTop = recallList(SETTINGS).top;
}

export function Settings() {
  const storage = useQuery(storageQuery);

  if (storage.isPending) return <SettingsSkeleton />;
  if (storage.isError) return <ErrorState error={storage.error} onRetry={() => void storage.refetch()} />;

  return (
    <div
      ref={backToWhereItWas}
      data-testid="settings"
      onScroll={(event) => rememberScroll(SETTINGS, event.currentTarget.scrollTop)}
      className="@container min-h-0 flex-1 scrollbar-stable overflow-y-auto"
    >
      <div className="flex flex-col gap-section px-gutter pt-gap pb-section">
        <Text as="h1" variant="title">
          Settings
        </Text>
        {/* First, because every section grows with it: anywhere lower, the slider moves away from under its own thumb. */}
        <InterfaceSizeSection />
        <PlaybackSection />
        <LibrarySection storage={storage.data} />
        <StorageSection storage={storage.data} />
        <MissingSection missing={storage.data.counts.missing} />
      </div>
    </div>
  );
}
