import { Ear } from 'lucide-react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { Button } from '@/components/ui/Button';
import type { EqCompare } from '@/features/Equalizer/hooks/useEqCompare';

type Props = {
  compare: EqCompare;
  disabled: boolean;
};

const HOLD_KEYS = new Set([' ', 'Enter']);

/** Press and hold, by finger, mouse or key, to hear the EQ off at the level it has on. */
export function HoldToCompare({ compare, disabled }: Props) {
  function onPointerDown(event: PointerEvent<HTMLButtonElement>): void {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    compare.start();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (!HOLD_KEYS.has(event.key)) return;
    // Otherwise Space goes on to play and pause.
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) compare.start();
  }

  function onKeyUp(event: KeyboardEvent<HTMLButtonElement>): void {
    if (!HOLD_KEYS.has(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    compare.stop();
  }

  return (
    <Button
      variant={compare.isComparing ? 'primary' : 'outline'}
      size="sm"
      disabled={disabled}
      aria-pressed={compare.isComparing}
      data-testid="hp-compare"
      className="touch-none"
      onPointerDown={onPointerDown}
      onPointerUp={compare.stop}
      onPointerCancel={compare.stop}
      onLostPointerCapture={compare.stop}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={compare.stop}
      onContextMenu={(event) => event.preventDefault()}
    >
      <Ear aria-hidden />
      {compare.isComparing ? 'Hearing EQ off, level matched' : 'Hold to hear EQ off'}
    </Button>
  );
}
