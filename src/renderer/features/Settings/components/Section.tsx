import type { ReactNode } from 'react';
import { Text } from '@/components/ui/Text';

type Props = {
  title: string;
  children: ReactNode;
};

export function Section({ title, children }: Props) {
  return (
    <section aria-label={title} className="flex flex-col gap-3 pt-section">
      <Text as="h2" variant="lead">
        {title}
      </Text>
      {children}
    </section>
  );
}
