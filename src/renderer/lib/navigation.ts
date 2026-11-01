/*
 * What the Library page's list column is showing: the active tab, what's been drilled into from it, and any search over the top.
 * Lives here because Search, Library and Settings all navigate and can't import each other. The actions are plain
 * functions, so a row can call one without subscribing to anything.
 */
import { create } from 'zustand';
import { closeArtOverlay } from '@/lib/artOverlay';
import { scrollCurrentListToTop } from '@/lib/listDom';
import { announceArrival, forgetAllLists, forgetList } from '@/lib/listMemory';
import { closeSettings, currentPage, showPage } from '@/lib/pages';
import type { SimilarSource } from '@/lib/queryKeys';
import { clearSelection } from '@/lib/selection';

export const LIBRARY_TABS = ['genres', 'artists', 'albums', 'tracks', 'playlists'] as const;
export type LibraryTab = (typeof LIBRARY_TABS)[number];

type DrillIn =
  /** Has a button rather than a tab, and shows over wherever the list was until it's left. */
  | { kind: 'queue' }
  | { kind: 'artist'; artistId: number }
  | { kind: 'album'; albumId: number }
  | { kind: 'genre'; genreId: number }
  | { kind: 'playlist'; playlistId: number }
  /** Tracks like this one or this playlist. The name is what the header says, so it doesn't take a read to show. */
  | { kind: 'similar'; source: SimilarSource; name: string }
  | { kind: 'missing' };

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

/** A search over it hides it, so then it isn't showing. */
export function showingQueue(state: NavigationState): boolean {
  return !isSearching(state) && currentPlace(state).kind === 'queue';
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
    case 'similar':
      return place.source.kind === 'track'
        ? `similar:track:${place.source.trackId}`
        : `similar:playlist:${place.source.playlistId}`;
    case 'search':
      return SEARCH_LIST;
    case 'missing':
    case 'queue':
      return place.kind;
  }
}

export const SEARCH_LIST = 'search';

// The queue is somewhere to look in on, like a tab, so it keeps its position.
function forgetLeftPlace(entry: HistoryEntry): void {
  if (entry.kind !== 'queue') forgetList(placeKey(entry));
}

/** Like going back, what's left this way starts from the top next time. */
export function selectTab(tab: LibraryTab): void {
  showPage('library');
  announceArrival('none');
  for (const entry of useNavigationStore.getState().history) forgetLeftPlace(entry);
  useNavigationStore.setState({ tab, history: [], query: '' });
}

/** The tab that's already showing: its root if something's over it, and the top of it if not. */
export function reselectTab(tab: LibraryTab): void {
  const { history, query } = useNavigationStore.getState();
  if (history.length > 0 || query !== '') selectTab(tab);
  else scrollCurrentListToTop();
}

/** Going where it already is, as a link to what's playing can, adds nothing to go back through. */
export function openPlace(place: DrillIn): void {
  showPage('library');
  const state = useNavigationStore.getState();
  if (!isSearching(state) && placeKey(currentPlace(state)) === placeKey(place)) return;
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

export function openSimilarToTrack(trackId: number, name: string): void {
  openPlace({ kind: 'similar', source: { kind: 'track', trackId }, name });
}

export function openSimilarToPlaylist(playlistId: number, name: string): void {
  openPlace({ kind: 'similar', source: { kind: 'playlist', playlistId }, name });
}

/**
 * Shows the queue in the Library page's list column, coming from another page if need be. Pressed while it's showing, it
 * returns to where the list was. Focus stays on what pressed this, which may want to press it again.
 */
export function toggleQueue(): void {
  const cameFromAnotherPage = currentPage() !== 'library';
  showPage('library');

  const state = useNavigationStore.getState();
  if (showingQueue(state)) {
    if (cameFromAnotherPage) return;
    announceArrival('left-search');
    leavePlace();
    return;
  }
  announceArrival('none');
  const search: HistoryEntry[] = isSearching(state) ? [{ kind: 'search', query: state.query }] : [];
  useNavigationStore.setState({ history: [...state.history, ...search, { kind: 'queue' }], query: '' });
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
 * Settings goes back to the page it was opened from, and another page to Library, which is left as it was. On Library it
 * closes what's over the art first, then leaves a search, then goes back one place. A place left this way starts from the
 * top next time.
 */
export function goBack(): void {
  if (currentPage() === 'settings') {
    closeSettings();
    return;
  }
  if (currentPage() !== 'library') {
    showPage('library');
    return;
  }
  if (closeArtOverlay() || clearSelection()) return;

  const { history, query } = useNavigationStore.getState();
  if (query !== '') {
    clearSearch();
    return;
  }

  if (history.length === 0) return;
  announceArrival('went-back');
  leavePlace();
}

function leavePlace(): void {
  const { history } = useNavigationStore.getState();
  const left = history.at(-1);
  if (left !== undefined) forgetLeftPlace(left);

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
  showPage('library');
  forgetAllLists();
  useNavigationStore.setState(INITIAL);
}
