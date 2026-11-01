import { useQuery } from '@tanstack/react-query';
import { useRef, useState, type MouseEvent, type ReactNode, type RefObject } from 'react';
import type { Lyrics as LyricsData } from '@shared/domain';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { LyricsControls } from '@/features/Lyrics/components/LyricsControls';
import { LyricsFixes } from '@/features/Lyrics/components/LyricsFixes';
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

function ignore(): void {}

type StateProps = {
  trackId: number;
  status: Exclude<LyricsData['status'], 'found'>;
};

function NoLyrics({ trackId, status }: StateProps) {
  const searchAgain = useSearchAgain(trackId);
  const isInstrumental = status === 'instrumental';
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-y-auto p-gutter">
        <Text as="p" variant="lead" color="muted">
          {NO_LYRICS_WORDS[status]}
        </Text>
        <Button variant="ghost" size="sm" loading={searchAgain.isPending} onClick={() => searchAgain.mutate()}>
          Search again
        </Button>
        {isInstrumental ? null : (
          <div className="flex w-140 max-w-full">
            <LyricsFixes trackId={trackId} onDone={ignore} />
          </div>
        )}
      </div>
      {isInstrumental ? <LyricsControls trackId={trackId} source={null} nudge={null} /> : null}
    </>
  );
}

type ContentsProps = {
  trackId: number;
  panel: RefObject<HTMLElement | null>;
};

function LyricsOfTrack({ trackId, panel }: ContentsProps) {
  const lyrics = useQuery(lyricsQuery(trackId));
  const [previewMs, setPreviewMs] = useState<number | null>(null);

  // Late: it's usually there before the scrim has finished coming in, but a first lookup goes out to LRCLIB.
  if (lyrics.isPending) {
    return (
      <div className="flex flex-1 animate-appear-late items-center justify-center p-gutter">
        <Text as="p" variant="lead" color="muted">
          Looking for lyrics
        </Text>
      </div>
    );
  }
  if (lyrics.isError) return <NoLyrics trackId={trackId} status="unavailable" />;
  if (lyrics.data.status !== 'found') return <NoLyrics trackId={trackId} status={lyrics.data.status} />;

  const { source, synced, plain, offsetMs } = lyrics.data;
  if (synced !== null) {
    const shownMs = previewMs ?? offsetMs;
    return (
      <>
        <SyncedLyrics key={trackId} lines={synced} offsetMs={shownMs} panel={panel} />
        <LyricsControls
          trackId={trackId}
          source={source}
          nudge={{ savedMs: offsetMs, shownMs, onPreview: setPreviewMs }}
        />
      </>
    );
  }
  return (
    <>
      <div
        data-testid="lyrics-plain"
        className="min-h-0 flex-1 [scrollbar-width:none] overflow-y-auto px-gutter py-section"
      >
        <Text as="p" variant="lyric" color="inherit" dir="auto">
          {plain}
        </Text>
      </div>
      <LyricsControls trackId={trackId} source={source} nudge={null} />
    </>
  );
}

/** Clicks inside a popover reach here through React, though it isn't inside this on the page. */
function closeOnBackground(event: MouseEvent<HTMLElement>): void {
  const { target, currentTarget } = event;
  if (!(target instanceof Element) || !currentTarget.contains(target)) return;
  if (target.closest('button, [data-keeps-lyrics-open]') === null) closeArtOverlay();
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
      <LyricsOfTrack key={trackId} trackId={trackId} panel={panel} />
    );

  return (
    // Below the title bar's strip, which would take any tap meant for what's under it.
    <div
      ref={panel}
      tabIndex={-1}
      data-testid="lyrics"
      data-under-toasts
      onClick={closeOnBackground}
      className="@container flex size-full animate-fade-rise flex-col bg-scrim-strong pt-title-bar focus-inset"
    >
      {contents}
    </div>
  );
}
