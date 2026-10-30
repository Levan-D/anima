import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

const inputClasses =
  'h-full w-full min-w-0 rounded-md bg-surface-raised px-3 text-body text-text select-text placeholder:text-text-muted';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(inputClasses, className)} {...props} />;
}
