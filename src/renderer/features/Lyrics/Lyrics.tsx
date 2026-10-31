import { useQuery } from '@tanstack/react-query';
import { useRef, type MouseEvent, type ReactNode } from 'react';
import type { Lyrics as LyricsData } from '@shared/domain';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { SyncedLyrics } from '@/features/Lyrics/components/SyncedLyrics';
import { useOverlayFocus } from '@/hooks/useOverlayFocus';
import { closeArtOverlay } from '@/lib/artOverlay';
import { lyricsQuery, useSearchAgain } from '@/lib/lyricsActions';
import { usePlayer } from '@/lib/playerStore';

const NO_LYRICS_WORDS: Record<Exclude<LyricsData['status'], 'found'>, string> = {
  instrumental: 'Instrumental',
  none: 'No lyrics for this track',
  unavailable: 'No lyrics right now',
};

type StateProps = {
  trackId: number;
  status: Exclude<LyricsData['status'], 'found'>;
};

function NoLyrics({ trackId, status }: StateProps) {
  const searchAgain = useSearchAgain(trackId);
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-gutter">
      <Text as="p" variant="lead" color="muted">
        {NO_LYRICS_WORDS[status]}
      </Text>
      <Button variant="ghost" size="sm" loading={searchAgain.isPending} onClick={() => searchAgain.mutate()}>
        Search again
      </Button>
    </div>
  );
}

type ContentsProps = {
  trackId: number;
};

function LyricsOfTrack({ trackId }: ContentsProps) {
  const lyrics = useQuery(lyricsQuery(trackId));

  // Quiet: it's usually there before the scrim has finished coming in.
  if (lyrics.isPending) return null;
  if (lyrics.isError) return <NoLyrics trackId={trackId} status="unavailable" />;
  if (lyrics.data.status !== 'found') return <NoLyrics trackId={trackId} status={lyrics.data.status} />;

  const { synced, plain, offsetMs } = lyrics.data;
  if (synced !== null) return <SyncedLyrics key={trackId} trackId={trackId} lines={synced} offsetMs={offsetMs} />;
  return (
    <div
      data-testid="lyrics-plain"
      className="min-h-0 flex-1 [scrollbar-width:none] overflow-y-auto px-gutter py-section"
    >
      <Text as="p" variant="lyric" color="inherit" dir="auto">
        {plain}
      </Text>
    </div>
  );
}

function closeOnBackground(event: MouseEvent<HTMLElement>): void {
  if (event.target instanceof Element && event.target.closest('button') === null) closeArtOverlay();
}

export function Lyrics() {
  const panel = useRef<HTMLDivElement>(null);
  useOverlayFocus(panel);
  const trackId = usePlayer((state) => state.current?.id ?? null);
  const contents: ReactNode =
    trackId === null ? (
      <div className="flex flex-1 items-center justify-center p-gutter">
        <Text as="p" variant="lead" color="muted">
          Nothing playing
        </Text>
      </div>
    ) : (
      <LyricsOfTrack key={trackId} trackId={trackId} />
    );

  return (
    // Below the title bar's strip, which would take any tap meant for what's under it.
    <div
      ref={panel}
      tabIndex={-1}
      data-testid="lyrics"
      onClick={closeOnBackground}
      className="@container flex size-full animate-fade-rise flex-col bg-scrim-strong pt-title-bar focus-inset"
    >
      {contents}
    </div>
  );
}
