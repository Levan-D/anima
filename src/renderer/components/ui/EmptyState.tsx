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
    <div
      className={cn(
        'content-in flex size-full min-w-0 flex-col items-center justify-center gap-gap p-gutter text-center',
        className,
      )}
    >
      {/* A title can quote what was typed, and a pasted file name has nowhere to break. */}
      <Text as="p" variant="lead" className="max-w-full wrap-anywhere">
        {title}
      </Text>
      {description ? (
        <Text as="p" color="muted" className="max-w-full wrap-anywhere">
          {description}
        </Text>
      ) : null}
      {action}
    </div>
  );
}
