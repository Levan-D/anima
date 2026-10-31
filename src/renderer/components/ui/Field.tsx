import type { ReactNode } from 'react';
import { Text } from '@/components/ui/Text';

type Props = {
  label: string;
  /** Sits to the right of the value, and drops under it when the column is too narrow. */
  action?: ReactNode;
  children: ReactNode;
};

/** A small muted label over the value it names. Paths can be long and have to stay readable, so the value wraps rather than truncates. */
export function Field({ label, action, children }: Props) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-gap">
      <div className="flex min-w-0 flex-[1_1_24em] flex-col">
        <Text variant="meta" color="muted">
          {label}
        </Text>
        <Text className="wrap-anywhere select-text">{children}</Text>
      </div>
      {action}
    </div>
  );
}
