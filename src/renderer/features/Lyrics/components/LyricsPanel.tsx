import { RotateCcw, Save } from 'lucide-react';
import type { Lyrics, LyricsSource } from '@shared/domain';
import { Button } from '@/components/ui/Button';
import { Divider } from '@/components/ui/Divider';
import { Stepper } from '@/components/ui/Stepper';
import { Text } from '@/components/ui/Text';
import { Tooltip } from '@/components/ui/Tooltip';
import { LyricsFixes } from '@/features/Lyrics/components/LyricsFixes';
import { formatOffset } from '@/features/Lyrics/utils/timeline';
import { setLyricsOffset } from '@/lib/lyricsActions';
import { usePlayer } from '@/lib/playerStore';

const NUDGE_MS = 500;

const SOURCE_WORDS: Record<LyricsSource, string> = {
  sidecar: 'Found in a .lrc beside the file',
  embedded: 'Embedded in the file',
  lrclib: 'From LRCLIB',
  chosen: 'Your own pick',
  own_file: 'From your file',
};

function loadedWords(lyrics: Lyrics): string {
  if (lyrics.status === 'instrumental') return 'Marked as instrumental';
  if (lyrics.status !== 'found') return 'No lyrics yet';
  return lyrics.source === 'lrclib' && lyrics.synced !== null ? 'Timed lyrics from LRCLIB' : SOURCE_WORDS[lyrics.source];
}

export type Nudge = {
  savedMs: number;
  shownMs: number;
  /** Null drops it, back to what's saved. */
  onPreview: (offsetMs: number | null) => void;
};

type TimingProps = {
  nudge: Nudge;
  onSave: (shownMs: number) => void;
};

function Timing({ nudge, onSave }: TimingProps) {
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-2">
        <Stepper
          downLabel="Show lyrics earlier"
          upLabel="Show lyrics later"
          onDown={() => nudge.onPreview(nudge.shownMs - NUDGE_MS)}
          onUp={() => nudge.onPreview(nudge.shownMs + NUDGE_MS)}
        >
          <Text variant="meta" color="muted" tabular data-testid="lyrics-offset">
            {formatOffset(nudge.shownMs)}
          </Text>
        </Stepper>
        <div className="ml-auto flex items-center gap-2">
          <Tooltip label="Reset">
            <Button
              variant="outline"
              size="icon-md"
              aria-label="Reset lyrics timing"
              disabled={nudge.shownMs === 0}
              onClick={() => nudge.onPreview(0)}
            >
              <RotateCcw aria-hidden />
            </Button>
          </Tooltip>
          <Tooltip label="Save">
            <Button
              variant="outline"
              size="icon-md"
              aria-label="Save lyrics timing"
              disabled={nudge.shownMs === nudge.savedMs}
              onClick={() => onSave(nudge.shownMs)}
            >
              <Save aria-hidden />
            </Button>
          </Tooltip>
        </div>
      </div>
      <Text as="p" variant="meta" color="muted" className="pt-1">
        Shifts this song's lyrics earlier or later. Save keeps it
      </Text>
    </div>
  );
}

type Props = {
  trackId: number;
  lyrics: Lyrics;
  /** Null when there's no timing to nudge. */
  nudge: Nudge | null;
  startsSearching?: boolean;
  /** A fix or a nudge went through. */
  onDone: () => void;
};

/** The song, where its lyrics came from, and what can be done about them. */
export function LyricsPanel({ trackId, lyrics, nudge, startsSearching = false, onDone }: Props) {
  const title = usePlayer((state) => state.current?.title ?? null);

  function save(shownMs: number): void {
    setLyricsOffset(trackId, shownMs);
    onDone();
  }

  return (
    <div data-keeps-lyrics-open className="flex min-h-0 w-full flex-col gap-3 no-drag">
      <div className="flex min-w-0 flex-col">
        <Text as="p" truncate>
          {title}
        </Text>
        <Text as="p" variant="meta" color="muted" data-testid="lyrics-source">
          {loadedWords(lyrics)}
        </Text>
      </div>
      <Divider />
      {nudge === null ? null : (
        <>
          <Timing nudge={nudge} onSave={save} />
          <Divider />
        </>
      )}
      <LyricsFixes
        trackId={trackId}
        hasLyrics={lyrics.status === 'found'}
        startsSearching={startsSearching}
        onDone={onDone}
      />
    </div>
  );
}
