import { createElement, type ComponentProps } from 'react';
import { cn } from '@/lib/cn';

export type TextVariant =
  'meta' | 'label' | 'body' | 'lead' | 'title' | 'nowPlaying' | 'heading' | 'display' | 'cover' | 'lyric';
export type TextColor = 'default' | 'muted' | 'faint' | 'accent' | 'danger' | 'inherit';

const variantClasses: Record<TextVariant, string> = {
  meta: 'text-meta',
  label: 'text-meta font-medium tracking-wide',
  body: 'text-body',
  lead: 'text-lead font-medium',
  title: 'text-title font-semibold optical-cut',
  // Takes a step up when a wide column beside the art has the room. Stacked, the art's height counts on the title size.
  nowPlaying: 'text-title font-semibold optical-cut side-by-side:@wide:text-heading',
  heading: 'text-heading font-semibold optical-cut',
  display: 'text-display font-semibold optical-cut',
  cover: 'text-cover font-semibold optical-cut wrap-anywhere',
  lyric: 'text-lyric font-semibold optical-cut wrap-anywhere whitespace-pre-line text-center',
};

const colorClasses: Record<TextColor, string> = {
  default: 'text-text',
  muted: 'text-text-muted',
  faint: 'text-text-faint',
  accent: 'text-accent',
  danger: 'text-danger',
  inherit: '',
};

type Props = Omit<ComponentProps<'span'>, 'color'> & {
  as?: 'span' | 'p' | 'div' | 'h1' | 'h2' | 'h3';
  variant?: TextVariant;
  color?: TextColor;
  /** For numbers that tick, so the digits don't shift. */
  tabular?: boolean;
  truncate?: boolean;
};

export function Text({
  as = 'span',
  variant = 'body',
  color = 'default',
  tabular = false,
  truncate = false,
  className,
  ...props
}: Props) {
  return createElement(as, {
    // Right-to-left text would otherwise be cut from its beginning, not its end.
    ...(truncate ? { dir: 'auto' } : {}),
    className: cn(
      variantClasses[variant],
      colorClasses[color],
      tabular && 'tabular-nums',
      // An inline box has no width to truncate against, and a span is the default.
      truncate && 'block truncate',
      className,
    ),
    ...props,
  });
}
