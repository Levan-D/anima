import type { ReactNode } from 'react';
import { Text } from '@/components/ui/Text';

type Props = {
  title: string;
  /** Still what a screen reader calls it. For when the tab it's on says the same thing. */
  hideTitle?: boolean;
  children: ReactNode;
};

export function Section({ title, hideTitle = false, children }: Props) {
  return (
    <section aria-label={title} className="flex flex-col gap-3 pt-gap">
      {hideTitle ? null : (
        <Text as="h2" variant="lead">
          {title}
        </Text>
      )}
      {children}
    </section>
  );
}
