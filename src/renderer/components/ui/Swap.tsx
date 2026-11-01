import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { EASE_STANDARD, useMotionDuration } from '@/lib/motionTokens';

const SHOWN = { opacity: 1 };
const AWAY = { opacity: 0 };
const LEAVING = { opacity: 0, pointerEvents: 'none' as const };

type Props = {
  /** A new one crossfades to what's in it now. */
  id: string;
  className?: string | undefined;
  /** For what holds the children. */
  innerClassName?: string | undefined;
  children: ReactNode;
};

/** One thing in another's place. What leaves is lifted out of the flow, so this takes the size of what's staying. */
export function Swap({ id, className, innerClassName, children }: Props) {
  const duration = useMotionDuration('--dur-quick');

  if (duration === 0) {
    return (
      <div className={className}>
        <div className={innerClassName}>{children}</div>
      </div>
    );
  }

  return (
    <div className={cn('relative', className)}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.div
          key={id}
          initial={AWAY}
          animate={SHOWN}
          exit={LEAVING}
          transition={{ duration, ease: EASE_STANDARD }}
          className={innerClassName}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
