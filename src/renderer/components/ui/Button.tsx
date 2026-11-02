import { LoaderCircle } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'danger'
  | 'tab'
  | 'side-tab'
  | 'quiet'
  | 'link'
  | 'row'
  | 'card'
  | 'segment'
  | 'pane'
  | 'lyric'
  | 'point'
  | 'pill'
  | 'pill-secondary';
export type ButtonSize =
  | 'sm'
  | 'md'
  | 'lg'
  | 'xl'
  | 'compact'
  | 'icon-sm'
  | 'icon-md'
  | 'icon'
  | 'tab'
  | 'row'
  | 'card'
  | 'bare'
  | 'mark'
  | 'pill'
  | 'chart-row';

// Looks smaller than a finger, so under a coarse pointer an invisible box brings it up to size. It never changes the layout.
const tapOnTouch =
  'min-h-0 min-w-0 any-pointer-coarse:after:absolute any-pointer-coarse:after:top-1/2 any-pointer-coarse:after:left-1/2 any-pointer-coarse:after:h-tap any-pointer-coarse:after:w-full any-pointer-coarse:after:min-w-tap any-pointer-coarse:after:-translate-1/2';

const variantClasses: Record<ButtonVariant, string> = {
  pill: 'rounded-full bg-surface-raised font-normal text-text-muted hover:bg-surface-hover hover:text-text data-[state=on]:bg-accent data-[state=on]:text-on-accent',
  // For a second set of pills beside the first, in the accent's complement.
  'pill-secondary':
    'rounded-full bg-surface-raised font-normal text-text-muted hover:bg-surface-hover hover:text-text data-[state=on]:bg-accent-complement data-[state=on]:text-on-accent-complement',
  primary: 'bg-accent text-on-accent hover:brightness-90',
  secondary: 'bg-surface-raised text-text hover:bg-surface-hover',
  // For a modal, whose surface a secondary button's fill would disappear into.
  outline: 'border border-outline text-text hover:bg-surface-hover active:bg-surface-active',
  ghost: 'text-text-muted hover:bg-surface-hover hover:text-text',
  danger: 'border border-danger text-danger hover:bg-surface-hover',
  tab: 'text-text-muted hover:text-text focus-inset data-[state=active]:text-text',
  'side-tab':
    'justify-start text-left text-text-muted hover:text-text focus-inset data-[state=active]:bg-surface-active data-[state=active]:text-text [&>span]:justify-start',
  quiet: 'justify-start text-left text-text-muted hover:text-text [&>span]:justify-start',
  // Inline text that goes somewhere. Under a coarse pointer an invisible box brings it up to size, reaching over what's above.
  link: 'min-h-0 min-w-0 shrink justify-start rounded-sm text-left font-normal text-text-muted hover:[&>span]:underline focus-visible:[&>span]:underline active:scale-100 any-pointer-coarse:after:absolute any-pointer-coarse:after:inset-x-0 any-pointer-coarse:after:bottom-0 any-pointer-coarse:after:h-tap [&>span]:min-w-0 [&>span]:justify-start',
  // A row in a list, full bleed: text-left because a button centers what it holds, and the content takes the width.
  row: 'w-full rounded-none text-left font-normal text-text hover:bg-surface-hover focus-inset active:scale-100 active:bg-surface-active [&>span]:w-full [&>span]:min-w-0 [&>span]:justify-start [&>span]:gap-gap',
  // Its surface reaches a little past it into the gaps, so the art doesn't touch the edge of it.
  card: 'group isolate min-w-0 flex-1 items-start rounded-sm text-left font-normal text-text before:absolute before:-inset-1.5 before:-z-10 before:rounded-md before:transition-colors before:duration-(--dur-fast) before:ease-standard hover:before:bg-surface-hover active:scale-100 active:before:bg-surface-active [&>span]:w-full [&>span]:flex-col [&>span]:items-stretch [&>span]:gap-0',
  segment: 'text-text-muted hover:text-text focus-inset data-[state=on]:bg-surface-active data-[state=on]:text-text',
  // A whole pane you can tap, showing what's in it and nothing of being a button.
  pane: 'rounded-none focus-pane active:scale-100',
  // A line of lyrics: bright while it's the current one, which aria-current says.
  lyric:
    'w-full text-text opacity-50 transition-opacity hover:opacity-70 active:scale-100 aria-[current=true]:opacity-100 [&>span]:w-full',
  // A point you drag on a plot: the whole target is finger-sized, and it's centered on where it is, whatever its style says.
  point:
    'absolute -translate-1/2 cursor-grab touch-none rounded-full text-text active:scale-100 active:cursor-grabbing data-[selected=true]:text-on-accent [&>span]:size-7 [&>span]:rounded-full [&>span]:border [&>span]:border-text-muted [&>span]:bg-surface-active hover:[&>span]:bg-surface-hover data-[selected=true]:[&>span]:border-accent data-[selected=true]:[&>span]:bg-accent',
};

const sizeClasses: Record<ButtonSize, string> = {
  pill: cn(tapOnTouch, 'h-8 px-3 text-meta whitespace-nowrap [&>span]:gap-1.5'),
  // These two lie close together on a chart, and a finger-sized box around each would take the pointer from its neighbours.
  mark: 'min-h-0 min-w-0 h-auto p-0 text-meta whitespace-nowrap',
  'chart-row': 'min-h-0 min-w-0 h-5 p-0 text-meta [&>span]:relative [&>span]:h-full',
  sm: cn(tapOnTouch, 'h-8 px-2.5 text-meta [&_svg]:size-4 [&>span]:gap-1.5'),
  md: cn(tapOnTouch, 'h-10 px-4 text-body [&_svg]:size-5 [&>span]:gap-2'),
  lg: 'px-5 text-body',
  xl: 'px-7 text-lead',
  // Finger-tall with small type, for a bar that's short of width.
  compact: 'px-3 text-meta',
  'icon-sm': cn(tapOnTouch, 'size-8 p-0 [&_svg]:size-4'),
  'icon-md': cn(tapOnTouch, 'size-10 p-0 [&_svg]:size-5'),
  icon: 'p-0',
  tab: 'px-2 text-body',
  row: 'h-full px-gutter text-body',
  card: 'p-0 text-body',
  bare: 'p-0 text-body',
};

type Props = ComponentProps<'button'> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and ignores clicks. Unlike `disabled` it keeps focus, and the name screen readers hear. */
  loading?: boolean;
};

export function Button({
  variant = 'secondary',
  size = 'lg',
  loading = false,
  type = 'button',
  className,
  children,
  onClick,
  ...props
}: Props) {
  return (
    <button
      type={type}
      aria-disabled={loading || undefined}
      aria-busy={loading || undefined}
      onClick={loading ? (event) => event.preventDefault() : onClick}
      className={cn(
        'relative inline-flex min-h-tap min-w-tap shrink-0 items-center justify-center rounded-md font-medium',
        'transition-[background-color,color,filter,scale] duration-(--dur-fast) ease-standard active:scale-97',
        'disabled:pointer-events-none disabled:opacity-40 aria-disabled:pointer-events-none aria-disabled:opacity-40',
        '[&_svg]:size-6 [&_svg]:shrink-0',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      <span className={cn('inline-flex items-center justify-center gap-3', loading && 'opacity-0')}>{children}</span>
      {loading ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <LoaderCircle aria-hidden className="animate-spin" />
        </span>
      ) : null}
    </button>
  );
}
