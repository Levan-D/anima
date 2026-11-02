import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

const inputClasses =
  'h-full w-full min-w-0 rounded-md bg-surface-raised px-3 text-text select-text placeholder:text-text-muted';

type Props = ComponentProps<'input'> & {
  /** Meta, to sit among small controls. */
  isSmall?: boolean;
};

export function Input({ isSmall = false, className, ...props }: Props) {
  return <input className={cn(inputClasses, isSmall ? 'text-meta' : 'text-body', className)} {...props} />;
}
