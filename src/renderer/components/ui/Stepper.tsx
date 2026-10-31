import { Minus, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/Button';

type Props = {
  /** What's being stepped, shown between the buttons. */
  children: ReactNode;
  downLabel: string;
  upLabel: string;
  onDown: () => void;
  onUp: () => void;
};

export function Stepper({ children, downLabel, upLabel, onDown, onUp }: Props) {
  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon" aria-label={downLabel} onClick={onDown}>
        <Minus aria-hidden />
      </Button>
      <span className="flex min-w-20 justify-center">{children}</span>
      <Button variant="ghost" size="icon" aria-label={upLabel} onClick={onUp}>
        <Plus aria-hidden />
      </Button>
    </div>
  );
}
