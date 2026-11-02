import type { ComponentProps } from 'react';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { formatCount } from '@/lib/format';

type Props = Omit<ComponentProps<typeof Button>, 'variant' | 'size'> & {
  count?: number | undefined;
  isSecondary?: boolean;
};

/** A small rounded choice, lit when its `data-state` is `on`, with how many it stands for after its name. */
export function Pill({ count, isSecondary = false, children, ...props }: Props) {
  return (
    <Button variant={isSecondary ? 'pill-secondary' : 'pill'} size="pill" {...props}>
      {children}
      {count === undefined ? null : (
        <Text variant="micro" color="inherit" tabular className="opacity-70">
          {formatCount(count)}
        </Text>
      )}
    </Button>
  );
}
