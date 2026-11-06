import type { RevealTarget } from '@shared/domain';
import { Button } from '@/components/ui/Button';
import { call } from '@/lib/api';
import { showToast } from '@/lib/toastStore';

type Props = {
  target: RevealTarget;
  /** What it reveals, for screen readers: every one of them just says Reveal. */
  what: string;
};

function revealPath(target: RevealTarget): void {
  void call('system.revealPath', { target }).then((result) => {
    if (!result.ok) showToast({ message: result.error.message, level: 'error' });
  });
}

export function RevealButton({ target, what }: Props) {
  return (
    <Button variant="outline" size="sm" aria-label={`Reveal ${what}`} onClick={() => revealPath(target)}>
      Reveal
    </Button>
  );
}
