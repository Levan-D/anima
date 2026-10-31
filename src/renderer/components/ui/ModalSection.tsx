import type { ReactNode } from 'react';
import { Text } from '@/components/ui/Text';

type Props = {
  /** Shown as the heading, and what a screen reader calls it. */
  title: string;
  children: ReactNode;
};

/** One block of a modal, with a line between it and the block above. */
export function ModalSection({ title, children }: Props) {
  return (
    <section aria-label={title} className="flex flex-col gap-3 border-t border-divider py-section first:border-t-0">
      <Text as="h3" variant="lead">
        {title}
      </Text>
      {children}
    </section>
  );
}
