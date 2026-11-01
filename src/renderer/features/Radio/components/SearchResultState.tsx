import type { ReactNode } from 'react';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';

type Props = {
  isLoading: boolean;
  isEmpty: boolean;
  emptyWords: string;
  error: unknown;
  onRetry: () => void;
  children: ReactNode;
};

export function SearchResultState({ isLoading, isEmpty, emptyWords, error, onRetry, children }: Props) {
  if (error !== null) return <ErrorState error={error} onRetry={onRetry} className="size-auto" />;
  if (isLoading) {
    return (
      <div aria-hidden className="flex flex-col gap-1">
        <Skeleton className="h-row w-full" />
        <Skeleton className="h-row w-full" />
      </div>
    );
  }
  if (isEmpty) {
    return (
      <Text as="p" color="muted" className="content-in py-1">
        {emptyWords}
      </Text>
    );
  }
  return <div className="content-in flex flex-col">{children}</div>;
}
