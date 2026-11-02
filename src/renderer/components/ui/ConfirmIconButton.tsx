import { CircleQuestionMark, type LucideIcon } from 'lucide-react';
import { useState, type ComponentProps } from 'react';
import { Button } from '@/components/ui/Button';
import { IconSwap } from '@/components/ui/IconSwap';
import { Tooltip } from '@/components/ui/Tooltip';
import { useTimeoutWhile } from '@/hooks/useTimeoutWhile';

const ASKS_FOR_MS = 5000;

type Props = Omit<ComponentProps<typeof Button>, 'onClick' | 'children' | 'aria-label' | 'variant' | 'size'> & {
  /** What it does, as its name and its tooltip. */
  label: string;
  icon: LucideIcon;
  onConfirm: () => void;
};

/**
 * Asks without taking any room: the first press turns its icon into a question mark, and a second press does it. It stops
 * asking after a few seconds, or when focus leaves.
 */
export function ConfirmIconButton({ label, icon: Icon, onConfirm, ...button }: Props) {
  const [isAsking, setIsAsking] = useState(false);

  useTimeoutWhile(isAsking, ASKS_FOR_MS, () => setIsAsking(false));

  function press(): void {
    if (isAsking) onConfirm();
    setIsAsking(!isAsking);
  }

  return (
    <Tooltip label={isAsking ? 'Press again to confirm' : label}>
      <Button
        {...button}
        variant="danger"
        size="icon-md"
        aria-label={isAsking ? `${label}: press again to confirm` : label}
        onBlur={() => setIsAsking(false)}
        onClick={press}
      >
        <IconSwap id={isAsking ? 'asking' : 'idle'}>
          {isAsking ? <CircleQuestionMark aria-hidden /> : <Icon aria-hidden />}
        </IconSwap>
      </Button>
    </Tooltip>
  );
}
