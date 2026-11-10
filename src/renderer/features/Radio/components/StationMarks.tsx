import { useQuery } from '@tanstack/react-query';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Button } from '@/components/ui/Button';
import { Tooltip } from '@/components/ui/Tooltip';
import { EASE_STANDARD, useMotionDuration } from '@/lib/motionTokens';
import { markMood, moodCardsQuery } from '@/lib/moodQueries';
import { usePlayer } from '@/lib/playerStore';
import { showToast, tellIfRefused } from '@/lib/toastStore';

const SOMEONE_ELSES = 'this mood';

function MarkButtons({ stationId, trackId, title }: { stationId: number; trackId: number; title: string }) {
  const name = useQuery({
    ...moodCardsQuery,
    select: (cards) => cards.find(({ id }) => id === stationId)?.name ?? SOMEONE_ELSES,
  }).data;
  const station = name ?? SOMEONE_ELSES;

  function mark(isYes: boolean): void {
    void markMood(stationId, trackId, isYes).then((result) => {
      tellIfRefused(result);
      if (!result.ok) return;
      const side = isYes ? `as belonging in ${station}` : `as not for ${station}`;
      showToast({ message: `Marked ${title} ${side}. What plays next takes it into account.` });
    });
  }

  return (
    <div className="flex items-center">
      <Tooltip label={`Not for ${station}`}>
        <Button variant="ghost" size="icon-sm" aria-label={`Not for ${station}`} onClick={() => mark(false)}>
          <ThumbsDown aria-hidden />
        </Button>
      </Tooltip>
      <Tooltip label={`Belongs in ${station}`}>
        <Button variant="ghost" size="icon-sm" aria-label={`Belongs in ${station}`} onClick={() => mark(true)}>
          <ThumbsUp aria-hidden />
        </Button>
      </Tooltip>
    </div>
  );
}

/** While a mood station plays, a word on the song that's on, which it learns from for what comes next. */
export function StationMarks() {
  const stationId = usePlayer((state) => (state.radio.isSource ? state.radio.stationId : null));
  const trackId = usePlayer((state) => state.current?.id ?? null);
  const title = usePlayer((state) => state.current?.title ?? '');
  const duration = useMotionDuration('--dur-mid');
  const isShown = stationId !== null && trackId !== null;

  // It comes and goes beside Tune it, so it opens sideways rather than pushing the button over at once.
  return (
    <AnimatePresence initial={false}>
      {isShown ? (
        <motion.div
          key="marks"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 'auto', opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration, ease: EASE_STANDARD }}
          className="shrink-0 overflow-clip [overflow-clip-margin:var(--focus-width)]"
        >
          <MarkButtons stationId={stationId} trackId={trackId} title={title} />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
