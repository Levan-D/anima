import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { EASE_STANDARD, useMotionDuration } from '@/lib/motionTokens';

type Props = {
  open: boolean;
  /** For a flex column that shares its height out: opens to this share instead of its own height. Needs a `basis-0`. */
  grow?: number;
  className?: string | undefined;
  /** Only rendered while it's open, and stays as it last was while it closes. */
  children: ReactNode;
};

/** Opens by its height and closes the same way, pushing what's below. For what no transform can do. */
export function Collapse({ open, grow, className, children }: Props) {
  const duration = useMotionDuration('--dur-mid');

  if (duration === 0) {
    if (!open) return null;
    return (
      <div className={className} {...(grow === undefined ? {} : { style: { flexGrow: grow } })}>
        {children}
      </div>
    );
  }

  const closedSize = grow === undefined ? { height: 0 } : { flexGrow: 0 };
  const openSize = grow === undefined ? { height: 'auto' } : { flexGrow: grow };
  // Hidden only on the way, or it would clip the focus rings of what's in it.
  const closed = { ...closedSize, opacity: 0, overflow: 'hidden' };
  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          key="open"
          initial={closed}
          animate={{ ...openSize, opacity: 1, overflow: 'hidden', transitionEnd: { overflow: 'visible' } }}
          exit={closed}
          transition={{ duration, ease: EASE_STANDARD }}
          className={className}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
