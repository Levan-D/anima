/*
 * What the list column is showing: the active tab, what's been drilled into from it, and any search over the top.
 * Lives here because Search, Library and Settings all navigate and can't import each other. The actions are plain
 * functions, so a row can call one without subscribing to anything.
 */
import { create } from 'zustand';
import { closeArtOverlay } from '@/lib/artOverlay';
import { scrollCurrentListToTop } from '@/lib/listDom';
import { announceArrival, forgetAllLists, forgetList } from '@/lib/listMemory';
import { clearSelection } from '@/lib/selection';

export const LIBRARY_TABS = ['albums', 'artists', 'genres', 'tracks', 'playlists', 'queue'] as const;
export type LibraryTab = (typeof LIBRARY_TABS)[number];

type DrillIn =
  | { kind: 'artist'; artistId: number }
  | { kind: 'album'; albumId: number }
  | { kind: 'genre'; genreId: number }
  | { kind: 'playlist'; playlistId: number }
  | { kind: 'missing' }
  | { kind: 'settings' };

/** A search stays in the history once a result is opened, so going back returns to the results. */
type HistoryEntry = DrillIn | { kind: 'search'; query: string };

type NavigationState = {
  tab: LibraryTab;
  history: HistoryEntry[];
  /** What's in the search field. Results show while it has anything in it. */
  query: string;
};

type Place = DrillIn | { kind: 'tab'; tab: LibraryTab };

const INITIAL: NavigationState = { tab: 'albums', history: [], query: '' };

const useNavigationStore = create<NavigationState>()(() => INITIAL);

export function useNavigation<T>(selector: (state: NavigationState) => T): T {
  return useNavigationStore(selector);
}

export function isSearching({ query }: NavigationState): boolean {
  return query.trim() !== '';
}

const TAB_PLACES = Object.fromEntries(LIBRARY_TABS.map((tab) => [tab, { kind: 'tab', tab }])) as Record<
  LibraryTab,
  Place
>;

/** Where the list is once any search is out of the way. */
export function currentPlace({ tab, history }: NavigationState): Place {
  const top = history.at(-1);
  return top === undefined || top.kind === 'search' ? TAB_PLACES[tab] : top;
}

/** Not for a search alone: the back button appearing with the first letter typed would shove the field along. */
export function canGoBack({ history }: NavigationState): boolean {
  return history.length > 0;
}

export function placeKey(place: Place | HistoryEntry): string {
  switch (place.kind) {
    case 'tab':
      return place.tab;
    case 'artist':
      return `artist:${place.artistId}`;
    case 'album':
      return `album:${place.albumId}`;
    case 'genre':
      return `genre:${place.genreId}`;
    case 'playlist':
      return `playlist:${place.playlistId}`;
    case 'search':
      return SEARCH_LIST;
    case 'missing':
    case 'settings':
      return place.kind;
  }
}

export const SEARCH_LIST = 'search';

/** Like going back, what's left this way starts from the top next time. */
export function selectTab(tab: LibraryTab): void {
  announceArrival('none');
  for (const entry of useNavigationStore.getState().history) forgetList(placeKey(entry));
  useNavigationStore.setState({ tab, history: [], query: '' });
}

/** The tab that's already showing: its root if something's over it, and the top of it if not. */
export function reselectTab(tab: LibraryTab): void {
  const { history, query } = useNavigationStore.getState();
  if (history.length > 0 || query !== '') selectTab(tab);
  else scrollCurrentListToTop();
}

export function openPlace(place: DrillIn): void {
  announceArrival('drilled-in');
  useNavigationStore.setState((state) => {
    const search: HistoryEntry[] = isSearching(state) ? [{ kind: 'search', query: state.query }] : [];
    return { history: [...state.history, ...search, place], query: '' };
  });
}

export function openArtist(artistId: number): void {
  openPlace({ kind: 'artist', artistId });
}

export function openAlbum(albumId: number): void {
  openPlace({ kind: 'album', albumId });
}

export function openGenre(genreId: number): void {
  openPlace({ kind: 'genre', genreId });
}

export function openPlaylist(playlistId: number): void {
  openPlace({ kind: 'playlist', playlistId });
}

/** Leaves search, and comes back to Settings if it's already open underneath. */
export function openSettings(): void {
  useNavigationStore.setState((state) => {
    const isOpen = state.history.at(-1)?.kind === 'settings';
    return { query: '', history: isOpen ? state.history : [...state.history, { kind: 'settings' }] };
  });
}

export function setSearchQuery(query: string): void {
  forgetList(SEARCH_LIST);
  useNavigationStore.setState({ query });
}

export function clearSearch(): void {
  forgetList(SEARCH_LIST);
  announceArrival('left-search');
  useNavigationStore.setState({ query: '' });
}

/**
 * Closes what's over the art first, then leaves a search, then goes back one place. A place left this way starts from the
 * top next time.
 */
export function goBack(): void {
  if (closeArtOverlay() || clearSelection()) return;

  const { history, query } = useNavigationStore.getState();
  if (query !== '') {
    clearSearch();
    return;
  }

  const left = history.at(-1);
  if (left === undefined) return;
  forgetList(placeKey(left));
  announceArrival('went-back');

  const rest = history.slice(0, -1);
  const under = rest.at(-1);
  if (under?.kind === 'search') {
    useNavigationStore.setState({ history: rest.slice(0, -1), query: under.query });
  } else {
    useNavigationStore.setState({ history: rest });
  }
}

/** For a different library: ids mean nothing in the next one. */
export function resetNavigation(): void {
  forgetAllLists();
  useNavigationStore.setState(INITIAL);
}
