import type { ReactNode } from 'react';
import { HoverWord } from '@/components/ui/HoverWord';
import { Tooltip } from '@/components/ui/Tooltip';

type Props = {
  /** What the words mean. */
  label: string;
  className?: string;
  children: ReactNode;
};

/** Words that explain themselves when pointed at, for a term there's no room to spell out on screen. There's nothing to press. */
export function Hint({ label, className, children }: Props) {
  return (
    <Tooltip label={label} staysOnPress>
      <HoverWord {...(className ? { className } : {})}>{children}</HoverWord>
    </Tooltip>
  );
}
