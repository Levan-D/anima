import { useMemo, useRef, type RefObject } from 'react';
import type { LyricLine } from '@shared/domain';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { useFollowLine } from '@/features/Lyrics/hooks/useFollowLine';
import { timelineOf } from '@/features/Lyrics/utils/timeline';
import { seekTo } from '@/lib/playerActions';

type Props = {
  lines: LyricLine[];
  offsetMs: number;
  panel: RefObject<HTMLElement | null>;
};

export function SyncedLyrics({ lines, offsetMs, panel }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => timelineOf(lines), [lines]);
  const backToLine = useFollowLine(rows, offsetMs, { scroller, track, panel });

  return (
    <div
      ref={scroller}
      data-testid="lyrics-lines"
      className="relative flex min-h-0 flex-1 [scrollbar-width:none] flex-col overflow-y-auto px-gutter"
    >
      <div className="h-1/2 shrink-0" />
      <div ref={track} className="relative flex shrink-0 flex-col gap-3 will-change-transform">
        {rows.map(({ startMs, text }, index) => (
          // No tab stop for each of up to 189 lines, and no focus from a click, or the next Space would seek rather than pause.
          <Button
            key={startMs}
            data-line={index}
            variant="lyric"
            size="bare"
            tabIndex={-1}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              backToLine();
              seekTo(startMs + offsetMs);
            }}
          >
            <Text variant="lyric" color="inherit" dir="auto">
              {text}
            </Text>
          </Button>
        ))}
      </div>
      <div className="h-1/2 shrink-0" />
    </div>
  );
}
