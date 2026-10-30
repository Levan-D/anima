import { DropdownMenu as RadixDropdownMenu } from 'radix-ui';
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

type Props = Omit<ComponentProps<typeof RadixDropdownMenu.Trigger>, 'asChild' | 'children' | 'className'> & {
  entries: MenuEntry[];
  align?: 'start' | 'center' | 'end';
  /** For the menu, not the button that opens it. */
  className?: string;
  /** The button that opens the menu. It has to accept a ref and spread its props, as `<Button>` does. */
  children: ReactElement;
};

type EntryProps = {
  entry: MenuEntry;
};

function Entry({ entry }: EntryProps) {
  if (entry.kind === 'separator') return <RadixDropdownMenu.Separator className={menuSeparatorClasses} />;

  if (entry.kind === 'label') {
    return (
      <RadixDropdownMenu.Label className={menuLabelClasses}>
        <Text variant="meta" color="muted">
          {entry.label}
        </Text>
      </RadixDropdownMenu.Label>
    );
  }

  return (
    <RadixDropdownMenu.Item className={menuItemClasses} onSelect={entry.onSelect} disabled={entry.disabled ?? false}>
      <MenuRow item={entry} />
    </RadixDropdownMenu.Item>
  );
}

export function DropdownMenu({ entries, align = 'end', className, children, ...triggerProps }: Props) {
  return (
    <RadixDropdownMenu.Root>
      <RadixDropdownMenu.Trigger asChild {...triggerProps}>
        {children}
      </RadixDropdownMenu.Trigger>
      <RadixDropdownMenu.Portal>
        {/* The gap is a margin so it scales. Radix only takes a number for the padding, which just keeps the menu off the window's edge. */}
        <RadixDropdownMenu.Content
          align={align}
          collisionPadding={8}
          className={cn(
            menuContentClasses,
            'data-[side=bottom]:mt-1 data-[side=left]:mr-1 data-[side=right]:ml-1 data-[side=top]:mb-1',
            className,
          )}
        >
          {entries.map((entry, index) => (
            <Entry key={index} entry={entry} />
          ))}
        </RadixDropdownMenu.Content>
      </RadixDropdownMenu.Portal>
    </RadixDropdownMenu.Root>
  );
}
