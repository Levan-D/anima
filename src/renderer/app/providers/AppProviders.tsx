import { QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { Tooltip } from 'radix-ui';
import { TOOLTIP_DELAY_MS } from '@/components/ui/Tooltip';
import type { ReactNode } from 'react';
import { ErrorBoundary } from '@/app/ErrorBoundary';
import { Toaster } from '@/components/ui/Toaster';
import { queryClient } from '@/lib/queryClient';

type Props = {
  children: ReactNode;
};

/** The mini's, which has no room for toasts and says them in its strip. */
export function MiniProviders({ children }: Props) {
  return (
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <Tooltip.Provider delayDuration={TOOLTIP_DELAY_MS} skipDelayDuration={0}>
          {children}
        </Tooltip.Provider>
      </MotionConfig>
    </QueryClientProvider>
  );
}

export function AppProviders({ children }: Props) {
  return (
    <MiniProviders>
      {children}
      <ErrorBoundary fallback={null}>
        <Toaster />
      </ErrorBoundary>
    </MiniProviders>
  );
}
