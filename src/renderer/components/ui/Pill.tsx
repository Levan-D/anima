import type { ComponentProps } from 'react';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { formatCount } from '@/lib/format';

type Props = Omit<ComponentProps<typeof Button>, 'variant' | 'size'> & {
  count?: number | undefined;
};

/** A small rounded choice, lit when its `data-state` is `on`, with how many it stands for after its name. */
export function Pill({ count, children, ...props }: Props) {
  return (
    <Button variant="pill" size="pill" {...props}>
      {children}
      {count === undefined ? null : (
        <Text variant="micro" color="inherit" tabular className="opacity-70">
          {formatCount(count)}
        </Text>
      )}
    </Button>
  );
}
