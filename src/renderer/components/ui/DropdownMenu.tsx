import { DropdownMenu as RadixDropdownMenu } from 'radix-ui';
import { useState, type ComponentProps, type KeyboardEvent, type ReactElement } from 'react';
import { Button } from '@/components/ui/Button';
import { MenuRow, SubmenuRow } from '@/components/ui/MenuRow';
import {
  menuContentClasses,
  menuItemClasses,
  menuLabelClasses,
  menuSeparatorClasses,
  type MenuEntry,
  type MenuRowAction,
} from '@/components/ui/menuEntries';
import { Text } from '@/components/ui/Text';
import { cn } from '@/lib/cn';

type Props = Omit<ComponentProps<typeof RadixDropdownMenu.Trigger>, 'asChild' | 'children' | 'className'> & {
  entries: MenuEntry[];
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** Stays in view under the entries, which scroll by themselves. */
  footer?: MenuEntry[];
  /** For the menu, not the button that opens it. */
  className?: string;
  /** The button that opens the menu. It has to accept a ref and spread its props, as `<Button>` does. */
  children: ReactElement;
};

type EntryProps = {
  entry: MenuEntry;
  /** For a row's own button, which isn't choosing the row. */
  onClose: () => void;
};

function Entry({ entry, onClose }: EntryProps) {
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

  if (entry.kind === 'submenu') {
    return (
      <RadixDropdownMenu.Sub>
        <RadixDropdownMenu.SubTrigger className={menuItemClasses} disabled={entry.disabled ?? false}>
          <SubmenuRow item={entry} />
        </RadixDropdownMenu.SubTrigger>
        <RadixDropdownMenu.Portal>
          <RadixDropdownMenu.SubContent
            collisionPadding={8}
            className={cn(
              menuContentClasses,
              'max-h-(--radix-dropdown-menu-content-available-height) origin-(--radix-dropdown-menu-content-transform-origin) overflow-y-auto',
            )}
          >
            {entry.entries.map((inner, index) => (
              <Entry key={index} entry={inner} onClose={onClose} />
            ))}
          </RadixDropdownMenu.SubContent>
        </RadixDropdownMenu.Portal>
      </RadixDropdownMenu.Sub>
    );
  }

  const { actions = [] } = entry;
  function run(action: MenuRowAction): void {
    onClose();
    action.onSelect();
  }
  // The menu keeps focus on its rows, so the keyboard reaches a row's delete button by a key of its own.
  function onRowKey(event: KeyboardEvent<HTMLDivElement>): void {
    const danger = actions.find(({ isDanger }) => isDanger);
    if (danger === undefined || event.key !== 'Delete') return;
    event.preventDefault();
    run(danger);
  }

  return (
    <RadixDropdownMenu.Item
      className={menuItemClasses}
      onSelect={entry.onSelect}
      disabled={entry.disabled ?? false}
      onKeyDown={onRowKey}
    >
      <MenuRow item={entry} />
      {actions.map((action) => (
        <Button
          key={action.label}
          variant="ghost"
          size="icon-sm"
          tabIndex={-1}
          aria-label={action.label}
          title={action.label}
          className={cn('-mx-1', action.isDanger && 'text-danger hover:text-danger')}
          onPointerUp={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            run(action);
          }}
        >
          <action.icon aria-hidden />
        </Button>
      ))}
    </RadixDropdownMenu.Item>
  );
}

export function DropdownMenu({
  entries,
  align = 'end',
  side = 'bottom',
  footer,
  className,
  children,
  ...triggerProps
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const close = () => setIsOpen(false);

  return (
    <RadixDropdownMenu.Root open={isOpen} onOpenChange={setIsOpen}>
      <RadixDropdownMenu.Trigger asChild {...triggerProps}>
        {children}
      </RadixDropdownMenu.Trigger>
      <RadixDropdownMenu.Portal>
        {/* The gap is a margin so it scales. Radix only takes a number for the padding, which just keeps the menu off the window's edge. */}
        <RadixDropdownMenu.Content
          align={align}
          side={side}
          collisionPadding={8}
          className={cn(
            menuContentClasses,
            'origin-(--radix-dropdown-menu-content-transform-origin)',
            'data-[side=bottom]:mt-1 data-[side=left]:mr-1 data-[side=right]:ml-1 data-[side=top]:mb-1',
            footer && 'flex max-h-(--radix-dropdown-menu-content-available-height) flex-col',
            className,
          )}
        >
          {footer ? (
            <>
              <div className="max-h-96 min-h-0 overflow-y-auto">
                {entries.map((entry, index) => (
                  <Entry key={index} entry={entry} onClose={close} />
                ))}
              </div>
              <RadixDropdownMenu.Separator className={menuSeparatorClasses} />
              {footer.map((entry, index) => (
                <Entry key={index} entry={entry} onClose={close} />
              ))}
            </>
          ) : (
            entries.map((entry, index) => <Entry key={index} entry={entry} onClose={close} />)
          )}
        </RadixDropdownMenu.Content>
      </RadixDropdownMenu.Portal>
    </RadixDropdownMenu.Root>
  );
}
