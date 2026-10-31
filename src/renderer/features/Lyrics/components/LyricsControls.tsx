import { Pencil, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import type { LyricsSource } from '@shared/domain';
import { Button } from '@/components/ui/Button';
import { Popover } from '@/components/ui/Popover';
import { Stepper } from '@/components/ui/Stepper';
import { Text } from '@/components/ui/Text';
import { LyricsFixes } from '@/features/Lyrics/components/LyricsFixes';
import { formatOffset } from '@/features/Lyrics/utils/timeline';
import { setLyricsOffset } from '@/lib/lyricsActions';

const NUDGE_MS = 500;

const SOURCE_WORDS: Record<LyricsSource, string> = {
  sidecar: 'From the .lrc beside the music',
  embedded: "From the music file's tags",
  lrclib: 'From LRCLIB',
  chosen: 'Your pick from LRCLIB',
  own_file: 'Your own file',
};

export type Nudge = {
  savedMs: number;
  shownMs: number;
  /** Null drops it, back to what's saved. */
  onPreview: (offsetMs: number | null) => void;
};

type Props = {
  trackId: number;
  /** Null when there are no lyrics showing to have come from anywhere. */
  source: LyricsSource | null;
  /** Null when there's no timing to nudge. */
  nudge: Nudge | null;
};

/** One small button at the foot of the lyrics. The lines stay usable behind what it opens, to judge a nudge by. */
export function LyricsControls({ trackId, source, nudge }: Props) {
  const [isOpen, setIsOpen] = useState(false);

  function changeOpen(open: boolean): void {
    setIsOpen(open);
    if (!open) nudge?.onPreview(null);
  }

  function save(shownMs: number): void {
    setLyricsOffset(trackId, shownMs);
    changeOpen(false);
  }

  return (
    <div className="flex shrink-0 justify-center py-1">
      <Popover
        trigger={
          <Button variant="ghost" size="icon" aria-label="Lyrics timing and fixes" className="no-drag">
            <Pencil aria-hidden />
          </Button>
        }
        label="Lyrics timing and fixes"
        align="center"
        className="max-h-(--radix-popover-content-available-height) w-140 overflow-y-auto"
        open={isOpen}
        onOpenChange={changeOpen}
        staysOpenOutside
      >
        {source === null ? null : (
          <span className="flex justify-center">
            <Text variant="meta" color="muted" data-testid="lyrics-source">
              {SOURCE_WORDS[source]}
            </Text>
          </span>
        )}
        {nudge === null ? null : (
          <div className="flex flex-wrap items-center justify-center gap-1">
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
            <Button
              variant="ghost"
              size="icon"
              aria-label="Reset lyrics timing"
              disabled={nudge.shownMs === 0}
              onClick={() => nudge.onPreview(0)}
            >
              <RotateCcw aria-hidden />
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={nudge.shownMs === nudge.savedMs}
              onClick={() => save(nudge.shownMs)}
            >
              Save
            </Button>
          </div>
        )}
        <LyricsFixes trackId={trackId} onDone={() => changeOpen(false)} />
      </Popover>
    </div>
  );
}
