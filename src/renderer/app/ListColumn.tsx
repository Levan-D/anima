import { ErrorBoundary } from '@/app/ErrorBoundary';
import { ListHeader } from '@/app/ListHeader';
import { ListMetricsProbe } from '@/components/music/ListMetricsProbe';
import { Tabs } from '@/components/ui/Tabs';
import { Library } from '@/features/Library/Library';
import { ScanProgress } from '@/features/ScanProgress/ScanProgress';
import { SearchResults } from '@/features/Search/SearchResults';
import { Settings } from '@/features/Settings/Settings';
import { focusCurrentList } from '@/lib/listDom';
import {
  currentPlace,
  isSearching,
  LIBRARY_TABS,
  placeKey,
  reselectTab,
  selectTab,
  useNavigation,
  type LibraryTab,
} from '@/lib/navigation';
import { useBackKeys } from '@/lib/useBackKeys';

const TAB_LABELS: Record<LibraryTab, string> = {
  albums: 'Albums',
  artists: 'Artists',
  genres: 'Genres',
  tracks: 'Tracks',
  playlists: 'Playlists',
  queue: 'Queue',
};

const TAB_ITEMS = LIBRARY_TABS.map((value) => ({ value, label: TAB_LABELS[value] }));

function tabOf(value: string): LibraryTab | undefined {
  return LIBRARY_TABS.find((candidate) => candidate === value);
}

function onTabChosen(value: string): void {
  const tab = tabOf(value);
  if (tab) selectTab(tab);
}

function onTabReselected(value: string): void {
  const tab = tabOf(value);
  if (tab) reselectTab(tab);
}

function ListScreen() {
  const screen = useNavigation((state) => {
    if (isSearching(state)) return 'search';
    return currentPlace(state).kind === 'settings' ? 'settings' : 'library';
  });
  // Going somewhere else is a way out of a panel that broke.
  const where = useNavigation((state) => placeKey(currentPlace(state)));

  return (
    <ErrorBoundary key={`${screen}:${where}`}>
      {screen === 'search' ? <SearchResults /> : null}
      {screen === 'settings' ? <Settings /> : null}
      {screen === 'library' ? <Library /> : null}
    </ErrorBoundary>
  );
}

/** Everything right of the art and above the transport. No tab is lit while search or Settings has replaced the list. */
export function ListColumn() {
  useBackKeys();
  const activeTab = useNavigation((state) =>
    isSearching(state) || currentPlace(state).kind === 'settings' ? '' : state.tab,
  );

  return (
    <Tabs
      label="Library views"
      items={TAB_ITEMS}
      value={activeTab}
      onValueChange={onTabChosen}
      onReselect={onTabReselected}
      onArrowDown={focusCurrentList}
      bar={<ListHeader />}
      className="min-h-0 flex-1"
    >
      <ListMetricsProbe />
      <ErrorBoundary className="h-auto shrink-0 flex-row">
        <ScanProgress />
      </ErrorBoundary>
      <ListScreen />
    </Tabs>
  );
}
