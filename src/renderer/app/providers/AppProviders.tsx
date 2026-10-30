import { QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { Tooltip } from 'radix-ui';
import type { ReactNode } from 'react';
import { ErrorBoundary } from '@/app/ErrorBoundary';
import { Toaster } from '@/components/ui/Toaster';
import { queryClient } from '@/lib/queryClient';

type Props = {
  children: ReactNode;
};

export function AppProviders({ children }: Props) {
  return (
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <Tooltip.Provider>
          {children}
          <ErrorBoundary fallback={null}>
            <Toaster />
          </ErrorBoundary>
        </Tooltip.Provider>
      </MotionConfig>
    </QueryClientProvider>
  );
}
