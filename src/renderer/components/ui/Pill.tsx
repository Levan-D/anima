import type { ComponentProps } from 'react';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { formatCount } from '@/lib/format';

type Props = Omit<ComponentProps<typeof Button>, 'variant' | 'size'> & {
  count?: number | undefined;
  isSecondary?: boolean;
  /** Edged rather than filled, for a modal's surface, which the fill disappears into. */
  isOutlined?: boolean;
};

const VARIANTS = {
  filled: { primary: 'pill', secondary: 'pill-secondary' },
  outlined: { primary: 'pill-outline', secondary: 'pill-secondary-outline' },
} as const;

/** A small rounded choice, lit when its `data-state` is `on`, with how many it stands for after its name. */
export function Pill({ count, isSecondary = false, isOutlined = false, children, ...props }: Props) {
  const variant = VARIANTS[isOutlined ? 'outlined' : 'filled'][isSecondary ? 'secondary' : 'primary'];
  return (
    <Button variant={variant} size="pill" {...props}>
      {children}
      {count === undefined ? null : (
        <Text variant="micro" color="inherit" tabular className="opacity-70">
          {formatCount(count)}
        </Text>
      )}
    </Button>
  );
}
