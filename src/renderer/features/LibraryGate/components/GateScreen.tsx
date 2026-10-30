import type { ReactNode } from 'react';
import { Text, type TextVariant } from '@/components/ui/Text';

type Props = {
  title?: string;
  titleVariant?: Extract<TextVariant, 'title' | 'display'>;
  description?: ReactNode;
  /** The actions that fix it. */
  children?: ReactNode;
};

export function GateScreen({ title, titleVariant = 'title', description, children }: Props) {
  return (
    <main className="relative flex h-screen w-screen flex-col items-center justify-center gap-section p-section text-center">
      <div aria-hidden className="absolute inset-x-0 top-0 h-title-bar drag" />
      {title ? (
        <Text as="h1" variant={titleVariant} className="max-w-200">
          {title}
        </Text>
      ) : null}
      {description ? (
        <Text as="p" color="muted" className="max-w-160 wrap-anywhere select-text">
          {description}
        </Text>
      ) : null}
      {children ? <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{children}</div> : null}
    </main>
  );
}
