import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Without this, tailwind-merge takes text-body for a color and drops it next to text-text-muted.
const merge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['meta', 'body', 'lead', 'title', 'display', 'cover'],
      spacing: ['tap', 'row', 'gutter', 'gap', 'section', 'transport', 'title-bar'],
      ease: ['standard'],
    },
  },
});

export function cn(...classes: ClassValue[]): string {
  return merge(clsx(classes));
}
