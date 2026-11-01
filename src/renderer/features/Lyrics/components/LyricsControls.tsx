import { Pencil } from 'lucide-react';
import { useState } from 'react';
import type { Lyrics } from '@shared/domain';
import { Button } from '@/components/ui/Button';
import { Divider } from '@/components/ui/Divider';
import { Popover } from '@/components/ui/Popover';
import { LyricsPanel, type Nudge } from '@/features/Lyrics/components/LyricsPanel';

type Props = {
  trackId: number;
  lyrics: Lyrics;
  /** Null when there's no timing to nudge. */
  nudge: Nudge | null;
};

/** One small button at the foot of the lyrics. The lines stay usable behind what it opens, to judge a nudge by. */
export function LyricsControls({ trackId, lyrics, nudge }: Props) {
  const [isOpen, setIsOpen] = useState(false);

  function changeOpen(open: boolean): void {
    setIsOpen(open);
    if (!open) nudge?.onPreview(null);
  }

  return (
    <div className="flex shrink-0 flex-col items-center">
      <Divider />
      <div className="flex justify-center py-1">
        <Popover
          trigger={
            <Button variant="ghost" size="icon" aria-label="Lyrics timing and fixes" className="no-drag">
              <Pencil aria-hidden />
            </Button>
          }
          label="Lyrics timing and fixes"
          align="center"
          className="max-h-(--radix-popover-content-available-height) w-140 overflow-y-auto [animation-duration:var(--dur-mid)]"
          open={isOpen}
          onOpenChange={changeOpen}
          staysOpenOutside
        >
          <LyricsPanel trackId={trackId} lyrics={lyrics} nudge={nudge} onDone={() => changeOpen(false)} />
        </Popover>
      </div>
    </div>
  );
}
