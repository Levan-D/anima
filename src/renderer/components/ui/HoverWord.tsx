import type { ComponentProps } from 'react';
import { Text } from '@/components/ui/Text';
import { cn } from '@/lib/cn';

/** A word on a chart that lights when pointed at, or when something in its `group/word` is. It isn't a control. */
export function HoverWord({ className, children, ...props }: ComponentProps<'span'>) {
  return (
    <span
      {...props}
      // Pressing it does nothing, and that includes taking focus from whatever has it.
      onMouseDown={(event) => event.preventDefault()}
      className={cn(
        'cursor-default whitespace-nowrap text-text-muted transition-colors duration-(--dur-fast) ease-standard group-hover/word:text-accent hover:text-accent',
        className,
      )}
    >
      <Text variant="meta" color="inherit">
        {children}
      </Text>
    </span>
  );
}
