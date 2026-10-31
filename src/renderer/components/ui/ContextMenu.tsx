import { ContextMenu as RadixContextMenu } from 'radix-ui';
import type { ComponentProps, ReactElement } from 'react';
import { MenuRow } from '@/components/ui/MenuRow';
import {
  menuContentClasses,
  menuItemClasses,
  menuLabelClasses,
  menuSeparatorClasses,
  type MenuEntry,
} from '@/components/ui/menuEntries';
import { Text } from '@/components/ui/Text';
import { cn } from '@/lib/cn';

type Props = Omit<ComponentProps<typeof RadixContextMenu.Trigger>, 'asChild' | 'children' | 'className'> & {
  entries: MenuEntry[];
  /** Leave these out to let it open wherever it's asked. With them, the caller can say no. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** For the menu, not the element that opens it. */
  className?: string;
  children: ReactElement;
};

type EntryProps = {
  entry: MenuEntry;
};

function Entry({ entry }: EntryProps) {
  if (entry.kind === 'separator') return <RadixContextMenu.Separator className={menuSeparatorClasses} />;

  if (entry.kind === 'label') {
    return (
      <RadixContextMenu.Label className={menuLabelClasses}>
        <Text variant="meta" color="muted">
          {entry.label}
        </Text>
      </RadixContextMenu.Label>
    );
  }

  return (
    <RadixContextMenu.Item className={menuItemClasses} onSelect={entry.onSelect} disabled={entry.disabled ?? false}>
      <MenuRow item={entry} />
    </RadixContextMenu.Item>
  );
}

export function ContextMenu({ entries, open, onOpenChange, className, children, ...triggerProps }: Props) {
  return (
    <RadixContextMenu.Root {...(open === undefined ? {} : { open })} {...(onOpenChange ? { onOpenChange } : {})}>
      <RadixContextMenu.Trigger asChild {...triggerProps}>
        {children}
      </RadixContextMenu.Trigger>
      <RadixContextMenu.Portal>
        {/* Radix only takes a number here. It just keeps the menu off the window's edge, so it needn't scale. */}
        <RadixContextMenu.Content collisionPadding={8} className={cn(menuContentClasses, className)}>
          {entries.map((entry, index) => (
            <Entry key={index} entry={entry} />
          ))}
        </RadixContextMenu.Content>
      </RadixContextMenu.Portal>
    </RadixContextMenu.Root>
  );
}
