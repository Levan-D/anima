import type { ReactNode } from 'react';
import { Divider } from '@/components/ui/Divider';
import { Text } from '@/components/ui/Text';

type Props = {
  /** Shown as the heading, and what a screen reader calls it. */
  title: string;
  children: ReactNode;
};

/** One block of a modal, with a line between it and the block above. */
export function ModalSection({ title, children }: Props) {
  return (
    <section aria-label={title} className="group/section relative flex flex-col gap-3 py-block">
      <Divider className="absolute inset-x-0 top-0 group-first/section:hidden" />
      <Text as="h3" variant="lead">
        {title}
      </Text>
      {children}
    </section>
  );
}
