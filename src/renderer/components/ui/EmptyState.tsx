import type { ReactNode } from 'react';
import { Text } from '@/components/ui/Text';
import { cn } from '@/lib/cn';

type Props = {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({ title, description, action, className }: Props) {
  return (
    <div className={cn('flex size-full flex-col items-center justify-center gap-gap p-gutter text-center', className)}>
      <Text as="p" variant="lead">
        {title}
      </Text>
      {description ? (
        <Text as="p" color="muted">
          {description}
        </Text>
      ) : null}
      {action}
    </div>
  );
}
