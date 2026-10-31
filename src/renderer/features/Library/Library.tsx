import type { ComponentType } from 'react';
import { AlbumsView } from '@/features/Library/components/AlbumsView';
import { AlbumView } from '@/features/Library/components/AlbumView';
import { ArtistsView } from '@/features/Library/components/ArtistsView';
import { ArtistView } from '@/features/Library/components/ArtistView';
import { GenresView } from '@/features/Library/components/GenresView';
import { GenreView } from '@/features/Library/components/GenreView';
import { MissingView } from '@/features/Library/components/MissingView';
import { NoMusic } from '@/features/Library/components/NoMusic';
import { TracksView } from '@/features/Library/components/TracksView';
import { useHasNoMusic } from '@/lib/libraryQueries';
import { currentPlace, useNavigation, type LibraryTab } from '@/lib/navigation';

// The queue, the playlists and Discover are features of their own, which the list column puts in this one's place.
const TAB_VIEWS: Record<Exclude<LibraryTab, 'queue' | 'playlists' | 'discover'>, ComponentType> = {
  albums: AlbumsView,
  artists: ArtistsView,
  genres: GenresView,
  tracks: TracksView,
};

/** What the list column shows when it's browsing: a tab, or whatever has been drilled into from one. */
export function Library() {
  const place = useNavigation(currentPlace);
  const hasNoMusic = useHasNoMusic();

  if (hasNoMusic) return <NoMusic />;

  switch (place.kind) {
    case 'tab': {
      if (place.tab === 'queue' || place.tab === 'playlists' || place.tab === 'discover') return null;
      const View = TAB_VIEWS[place.tab];
      return <View />;
    }
    case 'artist':
      return <ArtistView key={place.artistId} artistId={place.artistId} />;
    case 'album':
      return <AlbumView key={place.albumId} albumId={place.albumId} />;
    case 'genre':
      return <GenreView key={place.genreId} genreId={place.genreId} />;
    case 'missing':
      return <MissingView />;
    case 'playlist':
    case 'similar':
      return null;
  }
}
