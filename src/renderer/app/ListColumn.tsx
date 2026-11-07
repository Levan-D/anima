import { ErrorBoundary } from '@/app/ErrorBoundary';
import { ListMetricsProbe } from '@/components/music/ListMetricsProbe';
import { NewPlaylistDialog } from '@/components/music/NewPlaylistDialog';
import { Tabs } from '@/components/ui/Tabs';
import { Library } from '@/features/Library/Library';
import { Playlists } from '@/features/Playlists/Playlists';
import { MoreLikeThis } from '@/features/MoreLikeThis/MoreLikeThis';
import { ScanProgress } from '@/features/ScanProgress/ScanProgress';
import { SearchResults } from '@/features/Search/SearchResults';
import { SearchField } from '@/features/Search/SearchField';
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

const TAB_LABELS: Record<LibraryTab, string> = {
  genres: 'Genres',
  artists: 'Artists',
  albums: 'Albums',
  tracks: 'Tracks',
  playlists: 'Playlists',
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
    const place = currentPlace(state);
    if (place.kind === 'playlist' || (place.kind === 'tab' && place.tab === 'playlists')) return 'playlists';
    return place.kind === 'similar' ? 'similar' : 'library';
  });
  // Going somewhere else is a way out of a panel that broke.
  const where = useNavigation((state) => placeKey(currentPlace(state)));

  return (
    <ErrorBoundary key={`${screen}:${where}`}>
      {screen === 'search' ? <SearchResults /> : null}
      {screen === 'playlists' ? <Playlists /> : null}
      {screen === 'similar' ? <MoreLikeThis /> : null}
      {screen === 'library' ? <Library /> : null}
    </ErrorBoundary>
  );
}

/**
 * The list's column: everything above the transport, and right of the art when there is some. No tab is lit while search has
 * replaced the list. The search field takes what the tabs leave, and in a column under @md a row of its own under them.
 */
export function ListColumn() {
  const activeTab = useNavigation((state) => (isSearching(state) ? '' : state.tab));

  return (
    <Tabs
      label="Library views"
      items={TAB_ITEMS}
      value={activeTab}
      onValueChange={onTabChosen}
      onReselect={onTabReselected}
      onArrowDown={focusCurrentList}
      barClassName="@max-md/column:flex-wrap"
      beside={
        <ErrorBoundary className="h-auto w-auto flex-1 flex-row">
          <SearchField className="mr-gutter ml-auto max-w-80 min-w-tap flex-[1_1000_10em] focus-within:min-w-40 has-[input:not(:placeholder-shown)]:min-w-40 @max-md/column:ml-gutter @max-md/column:max-w-none @max-md/column:basis-full" />
        </ErrorBoundary>
      }
      className="min-h-0 flex-1"
    >
      <ListMetricsProbe />
      <ErrorBoundary className="h-auto shrink-0 flex-row">
        <ScanProgress />
      </ErrorBoundary>
      <ListScreen />
      <NewPlaylistDialog />
    </Tabs>
  );
}
