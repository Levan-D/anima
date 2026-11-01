import { X } from 'lucide-react';
import { Dialog as RadixDialog } from 'radix-ui';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Divider } from '@/components/ui/Divider';
import { Text } from '@/components/ui/Text';

type Props = {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  closeLabel: string;
};

/** The title and close button of a panel that's a Radix dialog, with the line under them. */
export function PanelHeader({ title, subtitle, actions, closeLabel }: Props) {
  return (
    <>
      <div className="flex shrink-0 items-center gap-1 pr-1 pb-1 pl-gutter">
        <div className="flex min-w-0 flex-1 flex-col">
          <RadixDialog.Title asChild>
            <Text as="h2" variant="lead" truncate>
              {title}
            </Text>
          </RadixDialog.Title>
          {subtitle}
        </div>
        {actions}
        <RadixDialog.Close asChild>
          <Button variant="ghost" size="icon" aria-label={closeLabel} className="shrink-0">
            <X aria-hidden />
          </Button>
        </RadixDialog.Close>
      </div>
      <Divider />
    </>
  );
}
