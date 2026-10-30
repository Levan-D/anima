import { createElement, type ComponentProps } from 'react';
import { cn } from '@/lib/cn';

export type TextVariant = 'meta' | 'body' | 'lead' | 'title' | 'display' | 'cover';
export type TextColor = 'default' | 'muted' | 'faint' | 'accent' | 'danger' | 'inherit';

const variantClasses: Record<TextVariant, string> = {
  meta: 'text-meta',
  body: 'text-body',
  lead: 'text-lead font-medium',
  title: 'text-title font-semibold optical-cut',
  display: 'text-display font-semibold optical-cut',
  cover: 'text-cover font-semibold optical-cut wrap-anywhere',
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
