import type { ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Tooltip } from '@/components/ui/Tooltip';

type Props = {
  /** What the words mean. */
  label: string;
  className?: string;
  children: ReactNode;
};

/** Words that explain themselves when pointed at, focused or tapped, for a term there's no room to spell out on screen. */
export function Hint({ label, className, children }: Props) {
  return (
    <Tooltip label={label} opensOnTap>
      <Button variant="mark" size="mark" {...(className ? { className } : {})}>
        {children}
      </Button>
    </Tooltip>
  );
}
