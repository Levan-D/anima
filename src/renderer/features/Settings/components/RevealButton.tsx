import type { RevealTarget } from '@shared/domain';
import { Button } from '@/components/ui/Button';
import { revealPath } from '@/features/Settings/utils/revealPath';

type Props = {
  target: RevealTarget;
  /** What it reveals, for screen readers: every one of them just says Reveal. */
  what: string;
};

export function RevealButton({ target, what }: Props) {
  return (
    <Button variant="outline" size="sm" aria-label={`Reveal ${what}`} onClick={() => revealPath(target)}>
      Reveal
    </Button>
  );
}
