import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

const textareaClasses =
  'w-full resize-none rounded-md focus-inset border border-divider bg-surface-raised px-3 py-2 text-text select-text placeholder:text-text-muted disabled:opacity-40';

// Code someone pastes or writes is in a fixed-width face, and its lines are kept as typed.
const kindClasses = {
  prose: 'text-body',
  code: 'font-mono text-meta whitespace-pre',
} as const;

type Props = ComponentProps<'textarea'> & {
  isCode?: boolean;
};

/** Input's look over several lines. Its height is what `rows` makes it: never dragged bigger by hand. */
export function Textarea({ isCode = false, className, ...props }: Props) {
  return (
    <textarea
      spellCheck={isCode ? false : undefined}
      autoCapitalize={isCode ? 'off' : undefined}
      autoCorrect={isCode ? 'off' : undefined}
      className={cn(textareaClasses, kindClasses[isCode ? 'code' : 'prose'], className)}
      {...props}
    />
  );
}
