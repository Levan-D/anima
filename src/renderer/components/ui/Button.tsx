import { LoaderCircle } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'tab' | 'quiet' | 'row' | 'card';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon' | 'tab' | 'row' | 'card' | 'bare';

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent hover:brightness-90',
  secondary: 'bg-surface-raised text-text hover:bg-surface-hover',
  ghost: 'text-text-muted hover:bg-surface-hover hover:text-text',
  danger: 'text-danger hover:bg-surface-hover',
  tab: 'text-text-muted hover:text-text data-[state=active]:text-text',
  quiet: 'justify-start text-left text-text-muted hover:text-text [&>span]:justify-start',
  // A row in a list, full bleed: text-left because a button centers what it holds, and the content takes the width.
  row: 'w-full rounded-none text-left font-normal text-text hover:bg-surface-hover focus-inset active:scale-100 active:bg-surface-active [&>span]:w-full [&>span]:min-w-0 [&>span]:justify-start [&>span]:gap-gap',
  card: 'group min-w-0 flex-1 items-start rounded-sm text-left font-normal text-text active:scale-100 [&>span]:w-full [&>span]:flex-col [&>span]:items-stretch [&>span]:gap-0',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-3 text-meta',
  md: 'px-5 text-body',
  lg: 'px-7 text-lead',
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
  size = 'md',
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
