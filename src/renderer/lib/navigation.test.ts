import { beforeEach, describe, expect, it } from 'vitest';
import { recallList, rememberFocus, rememberScroll, takeArrival } from '@/lib/listMemory';
import {
  canGoBack,
  clearSearch,
  currentPlace,
  goBack,
  isSearching,
  openAlbum,
  openArtist,
  openGenre,
  placeKey,
  reselectTab,
  resetNavigation,
  selectTab,
  setSearchQuery,
  useNavigation,
} from '@/lib/navigation';
import { openSettings, useSettingsDialog } from '@/lib/settingsDialog';
import { renderHook } from '@testing-library/react';

function state() {
  return renderHook(() => useNavigation((current) => current)).result.current;
}

function place() {
  return currentPlace(state());
}

beforeEach(() => {
  resetNavigation();
  takeArrival();
});

describe('going where it already is', () => {
  it('adds nothing to go back through', () => {
    openArtist(3);
    openArtist(3);
    goBack();
    expect(place().kind).toBe('tab');
  });

  it('still counts as going somewhere from the search results', () => {
    openArtist(3);
    setSearchQuery('x');
    openArtist(3);
    goBack();
    expect(isSearching(state())).toBe(true);
  });
});

describe('navigation', () => {
  it('starts on Genres with nothing drilled into', () => {
    expect(place()).toEqual({ kind: 'tab', tab: 'genres' });
  });

  it('drills in and comes back a step at a time', () => {
    openArtist(1);
    openAlbum(2);
    expect(place()).toEqual({ kind: 'album', albumId: 2 });

    goBack();
    expect(place()).toEqual({ kind: 'artist', artistId: 1 });

    goBack();
    expect(place()).toEqual({ kind: 'tab', tab: 'genres' });

    goBack();
    expect(place()).toEqual({ kind: 'tab', tab: 'genres' });
  });

  it('a tab goes to its root, leaving whatever was drilled into and any search', () => {
    openArtist(1);
    setSearchQuery('night');
    selectTab('tracks');
    expect(place()).toEqual({ kind: 'tab', tab: 'tracks' });
    expect(isSearching(state())).toBe(false);
    expect(state().query).toBe('');
  });

  it('search sits over the place it started from, and leaving it returns there', () => {
    openArtist(1);
    setSearchQuery('night');
    expect(isSearching(state())).toBe(true);
    expect(place()).toEqual({ kind: 'artist', artistId: 1 });

    clearSearch();
    expect(isSearching(state())).toBe(false);
    expect(place()).toEqual({ kind: 'artist', artistId: 1 });
  });

  it('only offers Back when there is somewhere to go back to, so typing does not shove the search field along', () => {
    expect(canGoBack(state())).toBe(false);
    setSearchQuery('night');
    expect(canGoBack(state())).toBe(false);
    clearSearch();
    openAlbum(1);
    expect(canGoBack(state())).toBe(true);
  });

  it('spaces alone are not a search', () => {
    setSearchQuery('   ');
    expect(isSearching(state())).toBe(false);
  });

  it('opening a result drills in, and going back returns to the results', () => {
    setSearchQuery('night');
    openAlbum(5);
    expect(isSearching(state())).toBe(false);
    expect(place()).toEqual({ kind: 'album', albumId: 5 });

    goBack();
    expect(state().query).toBe('night');
    expect(isSearching(state())).toBe(true);

    goBack();
    expect(state().query).toBe('');
    expect(place()).toEqual({ kind: 'tab', tab: 'genres' });
  });

  it('a different library closes Settings', () => {
    openSettings();
    resetNavigation();
    const { result } = renderHook(() => useSettingsDialog((dialog) => dialog.isOpen));
    expect(result.current).toBe(false);
  });

  it('a place left by going back starts from the top next time, and the one returned to keeps its position', () => {
    rememberScroll(placeKey({ kind: 'tab', tab: 'genres' }), 900);
    openAlbum(5);
    rememberScroll(placeKey({ kind: 'album', albumId: 5 }), 300);

    goBack();

    expect(recallList(placeKey({ kind: 'album', albumId: 5 })).top).toBe(0);
    expect(recallList(placeKey({ kind: 'tab', tab: 'genres' })).top).toBe(900);
  });

  it('a new search forgets where the last results were scrolled to', () => {
    setSearchQuery('night');
    rememberScroll('search', 400);
    setSearchQuery('nigh');
    expect(recallList('search').top).toBe(0);
  });

  it('the results keep their position while a result is open', () => {
    setSearchQuery('night');
    rememberScroll('search', 400);
    openAlbum(5);
    goBack();
    expect(recallList('search').top).toBe(400);
  });

  it('tells the next list how it was reached, once', () => {
    expect(takeArrival()).toBe('none');
    openAlbum(5);
    expect(takeArrival()).toBe('drilled-in');
    expect(takeArrival()).toBe('none');
    goBack();
    expect(takeArrival()).toBe('went-back');
  });

  it('tells it when it was reached by leaving a search, by Escape or by the button', () => {
    setSearchQuery('night');
    goBack();
    expect(takeArrival()).toBe('left-search');

    setSearchQuery('night');
    clearSearch();
    expect(takeArrival()).toBe('left-search');
  });

  it('a place left through a tab starts from the top next time, like one left by going back', () => {
    const genre = placeKey({ kind: 'genre', genreId: 3 });
    openGenre(3);
    rememberScroll(genre, 974);

    selectTab('genres');

    expect(recallList(genre).top).toBe(0);
  });

  it('a tab keeps its own position when another is chosen', () => {
    rememberScroll('tracks', 500);
    selectTab('genres');
    expect(recallList('tracks').top).toBe(500);
  });

  describe('the tab that is already showing', () => {
    function listAt(top: number): HTMLElement {
      document.body.innerHTML =
        '<div role="tabpanel"><div data-testid="scroller"><div role="list" tabindex="0"></div></div></div>';
      const scroller = document.querySelector<HTMLElement>('[data-testid="scroller"]') as HTMLElement;
      scroller.scrollTop = top;
      return scroller;
    }

    it('goes to the top of its list', () => {
      const scroller = listAt(800);
      reselectTab('albums');
      expect(scroller.scrollTop).toBe(0);
    });

    it('goes back to its root instead when something is over it, leaving the scroll alone', () => {
      const scroller = listAt(800);
      openAlbum(1);
      reselectTab('genres');
      expect(place()).toEqual({ kind: 'tab', tab: 'genres' });
      expect(scroller.scrollTop).toBe(800);
    });

    it('leaves a search first, too', () => {
      setSearchQuery('night');
      reselectTab('albums');
      expect(state().query).toBe('');
    });
  });

  it('a new library starts over', () => {
    selectTab('genres');
    openArtist(1);
    rememberScroll('genres', 100);
    rememberFocus('genres', { index: 2, column: 0 });

    resetNavigation();

    expect(place()).toEqual({ kind: 'tab', tab: 'genres' });
    expect(recallList('genres')).toMatchObject({ top: 0, focus: null });
  });
});
