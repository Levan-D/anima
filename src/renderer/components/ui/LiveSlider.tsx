import { Slider as RadixSlider } from 'radix-ui';
import { useImperativeHandle, useRef, type KeyboardEvent, type PointerEvent, type Ref } from 'react';
import { cn } from '@/lib/cn';

export type LiveSliderHandle = {
  /** Where it is now, out of how much. Call it every frame if you like: only what has changed gets written. */
  show: (value: number, max: number, valueText: string) => void;
};

type Props = {
  ref: Ref<LiveSliderHandle>;
  /** Announced to screen readers: the thumb has no visible text. */
  label: string;
  max: number;
  disabled?: boolean;
  /** The pointer went down, or moved. */
  onDrag: (value: number) => void;
  /** The pointer let go, or `committed` is false when something took it away. */
  onDragEnd: (committed: boolean) => void;
  /** Radix's own arrow keys go from the value it was given, which isn't where this is. So the keys are the caller's. */
  onKeyDown: (event: KeyboardEvent<HTMLSpanElement>) => void;
  className?: string;
};

// Never where a pointer can land, so Radix reports every move, even back to where a drag began. What's drawn doesn't
// come from this: it goes straight to the DOM, so a value that moves all the time never renders anything.
const OFF_THE_SCALE = [-1];

/** Less than a pixel on the widest line there is, and too small to see. */
const SMALLEST_MOVE = 1 / 2048;

/**
 * Radix's slider for a value that moves by itself, such as a playhead. It still does the pointer, the focus and the
 * ARIA, and the line and the dot are moved here with transforms, so they stay on the compositor.
 */
export function LiveSlider({ ref, label, max, disabled = false, onDrag, onDragEnd, onKeyDown, className }: Props) {
  const fillRef = useRef<HTMLSpanElement>(null);
  const dotRef = useRef<HTMLSpanElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const shown = useRef({ fraction: -1, valueText: '' });

  useImperativeHandle(
    ref,
    () => ({
      show(value, length, valueText) {
        const fraction = length > 0 ? Math.min(Math.max(value / length, 0), 1) : 0;
        const isAtAnEnd = fraction === 0 || fraction === 1;
        const moved = Math.abs(fraction - shown.current.fraction);
        if (moved >= SMALLEST_MOVE || (isAtAnEnd && moved > 0)) {
          shown.current.fraction = fraction;
          if (fillRef.current) fillRef.current.style.transform = `scaleX(${fraction})`;
          if (dotRef.current) dotRef.current.style.transform = `translateX(${fraction * 100}%)`;
        }
        if (valueText !== shown.current.valueText) {
          shown.current.valueText = valueText;
          thumbRef.current?.setAttribute('aria-valuenow', String(Math.round(value)));
          thumbRef.current?.setAttribute('aria-valuetext', valueText);
        }
      },
    }),
    [],
  );

  function onPointerDown(event: PointerEvent<HTMLSpanElement>): void {
    // Radix would start a drag on any button. Its own handler runs after this one, and leaves a prevented event alone.
    if (event.button !== 0) {
      event.preventDefault();
      return;
    }
    event.currentTarget.toggleAttribute('data-dragging', true);
  }

  function endDrag(event: PointerEvent<HTMLSpanElement>, committed: boolean): void {
    if (!event.currentTarget.hasAttribute('data-dragging')) return;
    event.currentTarget.toggleAttribute('data-dragging', false);
    onDragEnd(committed);
  }

  return (
    <RadixSlider.Root
      value={OFF_THE_SCALE}
      min={0}
      max={max}
      step={1}
      disabled={disabled}
      onValueChange={([value]) => {
        if (value !== undefined) onDrag(value);
      }}
      onPointerDown={onPointerDown}
      onPointerUp={(event) => endDrag(event, true)}
      onPointerCancel={(event) => endDrag(event, false)}
      onKeyDown={onKeyDown}
      className={cn(
        'group relative block h-tap w-full touch-none select-none data-disabled:pointer-events-none data-disabled:opacity-40',
        className,
      )}
    >
      <RadixSlider.Track className="absolute inset-x-0 top-3 h-1 overflow-hidden rounded-full bg-surface-active transition-[scale] duration-(--dur-fast) ease-standard group-hover:scale-y-150 group-data-dragging:scale-y-150">
        <span ref={fillRef} data-slot="fill" className="absolute inset-0 origin-left bg-accent will-change-transform" />
      </RadixSlider.Track>
      {/*
        The dot's layer spans the track, so a percentage of its own width is the same percentage along the line, at any
        size. Moved along, it would stick out past the window, so what's around it clips it, wide enough for the dot's ring.
      */}
      <span aria-hidden className="pointer-events-none absolute -inset-x-4 top-3 h-1 overflow-x-clip">
        <span ref={dotRef} className="absolute inset-x-4 inset-y-0 will-change-transform">
          <span
            data-slot="dot"
            className="absolute top-1/2 left-0 size-3.5 -translate-1/2 rounded-full bg-text opacity-0 transition-opacity duration-(--dur-fast) ease-standard group-hover:opacity-100 group-has-focus-visible:opacity-100 group-has-focus-visible:outline-(length:--focus-width) group-has-focus-visible:outline-offset-(--focus-width) group-has-focus-visible:outline-(--focus-ring) group-has-focus-visible:outline-solid group-data-dragging:opacity-100"
          />
        </span>
      </span>
      <RadixSlider.Thumb ref={thumbRef} aria-label={label} aria-valuenow={0} className="block size-0 outline-hidden" />
    </RadixSlider.Root>
  );
}
