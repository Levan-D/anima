import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

const textareaClasses =
  'w-full resize-none rounded-md focus-inset border border-divider bg-surface-raised px-3 py-2 text-body text-text select-text placeholder:text-text-muted';

/** Input's look over several lines. Its height is what `rows` makes it: never dragged bigger by hand. */
export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(textareaClasses, className)} {...props} />;
}
