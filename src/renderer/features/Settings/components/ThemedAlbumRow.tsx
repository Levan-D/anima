import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import type { ThemedAlbum, ThemedTrack, ThemeId } from '@shared/themes';
import { Button } from '@/components/ui/Button';
import { Collapse } from '@/components/ui/Collapse';
import { Text } from '@/components/ui/Text';
import { cn } from '@/lib/cn';
import { formatPlural } from '@/lib/format';
import { markTheme, type ThemeTarget } from '@/lib/seasons';

function sourceWords(tracks: readonly ThemedTrack[]): string {
  const auto = tracks.filter(({ isAuto }) => isAuto).length;
  if (auto === tracks.length) return 'auto';
  return auto === 0 ? 'by hand' : 'part auto, part by hand';
}

type Props = {
  theme: ThemeId;
  themeLabel: string;
  album: ThemedAlbum;
};

export function ThemedAlbumRow({ theme, themeLabel, album: { albumId, title, artist, tracks } }: Props) {
  const [isOpen, setIsOpen] = useState(false);

  // Takes out what's shown, and undoing puts back what put it there.
  function takeOut(target: ThemeTarget, what: string, isAuto: boolean): void {
    markTheme(target, 'none', `${what} taken out of ${themeLabel}`, {
      label: 'Undo',
      run: () => markTheme(target, isAuto ? 'auto' : theme, `${what} back in ${themeLabel}`),
    });
  }

  const allTracks: ThemeTarget = { kind: 'tracks', trackIds: tracks.map(({ trackId }) => trackId) };
  const whole: ThemeTarget = albumId === null ? allTracks : { kind: 'album', albumId };

  return (
    <li className="flex flex-col">
      <div className="flex items-center gap-gap">
        <Button
          variant="quiet"
          size="md"
          aria-expanded={isOpen}
          className="h-auto min-w-0 flex-1 py-1.5"
          onClick={() => setIsOpen(!isOpen)}
        >
          <ChevronDown
            aria-hidden
            className={cn('shrink-0 transition-transform duration-(--dur-mid) ease-standard', isOpen && 'rotate-180')}
          />
          <span className="flex min-w-0 flex-1 flex-col text-left">
            <Text truncate>{title ?? 'No album'}</Text>
            <Text truncate variant="meta" color="muted">
              {artist}, {formatPlural(tracks.length, 'song')}, {sourceWords(tracks)}
            </Text>
          </span>
        </Button>
        <Button
          variant="ghost"
          size="md"
          onClick={() => takeOut(whole, title ?? artist, tracks.every(({ isAuto }) => isAuto))}
        >
          Take out
        </Button>
      </div>
      <Collapse open={isOpen}>
        <ul className="flex flex-col gap-1.5 pb-1.5 pl-section">
          {tracks.map(({ trackId, title: song, artist: by, isAuto }) => (
            <li key={trackId} className="flex items-center gap-gap">
              <span className="flex min-w-0 flex-1 flex-col">
                <Text truncate>{song}</Text>
                <Text truncate variant="meta" color="muted">
                  {by}, {isAuto ? 'auto' : 'by hand'}
                </Text>
              </span>
              <Button
                variant="ghost"
                size="md"
                onClick={() => takeOut({ kind: 'tracks', trackIds: [trackId] }, song, isAuto)}
              >
                Take out
              </Button>
            </li>
          ))}
        </ul>
      </Collapse>
    </li>
  );
}
