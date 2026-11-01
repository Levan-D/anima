import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { EASE_STANDARD, useMotionDuration } from '@/lib/motionTokens';

const SHOWN = { opacity: 1, y: 0 };
const AWAY = { opacity: 0 };
const BELOW = { opacity: 0, y: '25%' };

type Props = {
  show: boolean;
  /** Comes up from a little below, for what floats. */
  rises?: boolean;
  className?: string | undefined;
  onGone?: (() => void) | undefined;
  /** Stays as it last was while it fades out. */
  children: ReactNode;
};

/** Fades what takes no room from anything else. It's out of the pointer's way as soon as it starts to leave. */
export function Fade({ show, rises = false, className, onGone, children }: Props) {
  const duration = useMotionDuration('--dur-mid');

  if (duration === 0) return show ? <div className={className}>{children}</div> : null;

  const hidden = rises ? BELOW : AWAY;
  return (
    <AnimatePresence initial={false} {...(onGone ? { onExitComplete: onGone } : {})}>
      {show ? (
        <motion.div
          key="shown"
          initial={hidden}
          animate={SHOWN}
          exit={{ ...hidden, pointerEvents: 'none' }}
          transition={{ duration, ease: EASE_STANDARD }}
          className={className}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
