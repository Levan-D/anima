import { useImperativeHandle, useRef, type Ref } from 'react';
import { useWaveformMask } from '@/features/Transport/hooks/useWaveformMask';
import { cn } from '@/lib/cn';

export type WaveformHandle = {
  /** How far along it is, from 0 to 1. Only the clip moves, so this never draws the bars again. */
  show: (fraction: number) => void;
};

type Props = {
  ref: Ref<WaveformHandle>;
  /** Null shows nothing, and the seekbar's line stays. */
  peaks: Uint8Array | null;
};

const LAYER = 'absolute inset-0 mask-size-[100%_100%] [mask-image:var(--waveform-mask)]';

/** Only what's drawn: it lets every pointer through to the slider on top of it. */
export function Waveform({ ref, peaks }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const playedRef = useRef<HTMLDivElement>(null);
  const shownClip = useRef('');

  useWaveformMask(rootRef, peaks);

  useImperativeHandle(
    ref,
    () => ({
      show(fraction) {
        const clip = `inset(0 ${(100 - fraction * 100).toFixed(2)}% 0 0)`;
        if (clip === shownClip.current) return;
        shownClip.current = clip;
        if (playedRef.current) playedRef.current.style.clipPath = clip;
      },
    }),
    [],
  );

  return (
    <div
      ref={rootRef}
      aria-hidden
      data-testid="waveform"
      data-has-peaks={peaks !== null}
      className={cn(
        'pointer-events-none absolute inset-x-0 top-0 h-waveform transition-opacity duration-(--dur-mid) ease-standard',
        peaks === null && 'opacity-0',
      )}
    >
      <div className={cn(LAYER, 'bg-surface-active')} />
      <div ref={playedRef} data-slot="played" className={cn(LAYER, 'bg-accent')} />
    </div>
  );
}
