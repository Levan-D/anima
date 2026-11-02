import type { ComponentProps } from 'react';
import { Text } from '@/components/ui/Text';
import { cn } from '@/lib/cn';

/** A word on a chart that lights when pointed at, or when something in its `group/word` is. There's nothing to press. */
export function HoverWord({ className, children, ...props }: ComponentProps<'span'>) {
  return (
    <span
      {...props}
      className={cn(
        'cursor-default whitespace-nowrap text-text-muted transition-colors duration-(--dur-fast) ease-standard group-hover/word:text-text hover:text-text',
        className,
      )}
    >
      <Text variant="meta" color="inherit">
        {children}
      </Text>
    </span>
  );
}
