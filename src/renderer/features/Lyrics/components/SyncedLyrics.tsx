import { Minus, Plus, RotateCcw } from 'lucide-react';
import { useMemo, useRef } from 'react';
import type { LyricLine } from '@shared/domain';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { useCurrentLine } from '@/features/Lyrics/hooks/useCurrentLine';
import { formatOffset, timelineOf } from '@/features/Lyrics/utils/timeline';
import { setLyricsOffset } from '@/lib/lyricsActions';
import { seekTo } from '@/lib/playerActions';

const NUDGE_MS = 500;

type Props = {
  trackId: number;
  lines: LyricLine[];
  offsetMs: number;
};

export function SyncedLyrics({ trackId, lines, offsetMs }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => timelineOf(lines), [lines]);
  useCurrentLine(rows, offsetMs, scroller);

  return (
    <>
      <div
        ref={scroller}
        data-testid="lyrics-lines"
        className="relative flex min-h-0 flex-1 [scrollbar-width:none] flex-col gap-3 overflow-y-auto px-gutter"
      >
        <div className="h-1/2 shrink-0" />
        {rows.map(({ startMs, text }, index) => (
          // No tab stop for each of up to 189 lines, and no focus from a click, or the next Space would seek rather than pause.
          <Button
            key={startMs}
            data-line={index}
            variant="lyric"
            size="bare"
            tabIndex={-1}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => seekTo(startMs + offsetMs)}
          >
            <Text variant="lyric" color="inherit" dir="auto">
              {text}
            </Text>
          </Button>
        ))}
        <div className="h-1/2 shrink-0" />
      </div>
      <div className="flex shrink-0 items-center justify-center gap-1 py-1">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Show lyrics earlier"
          onClick={() => setLyricsOffset(trackId, offsetMs - NUDGE_MS)}
        >
          <Minus aria-hidden />
        </Button>
        <span className="flex min-w-20 justify-center">
          <Text variant="meta" color="muted" tabular data-testid="lyrics-offset">
            {formatOffset(offsetMs)}
          </Text>
        </span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Show lyrics later"
          onClick={() => setLyricsOffset(trackId, offsetMs + NUDGE_MS)}
        >
          <Plus aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Reset lyrics timing"
          disabled={offsetMs === 0}
          onClick={() => setLyricsOffset(trackId, 0)}
        >
          <RotateCcw aria-hidden />
        </Button>
      </div>
    </>
  );
}
