import { DropdownMenu as RadixDropdownMenu } from 'radix-ui';
import { useState, type ComponentProps, type KeyboardEvent, type ReactElement } from 'react';
import { Button } from '@/components/ui/Button';
import { SearchInput } from '@/components/ui/SearchInput';
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
import { EDGE_CLEARANCE } from '@/components/ui/popper';

type Props = Omit<ComponentProps<typeof RadixDropdownMenu.Trigger>, 'asChild' | 'children' | 'className'> & {
  entries: MenuEntry[];
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** Stays in view under the entries, which scroll by themselves. */
  footer?: MenuEntry[];
  /** A field over the entries that narrows them by name, and a taller list, for one that gets long. */
  searchLabel?: string;
  /** For the menu, not the button that opens it. */
  className?: string;
  /** The button that opens the menu. It has to accept a ref and spread its props, as `<Button>` does. */
  children: ReactElement;
};

const LONG_MENU_SCROLLS = 'max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto';

type EntryProps = {
  entry: MenuEntry;
  /** For a row's own button, which isn't choosing the row. */
  onClose: () => void;
  /** Shorter rows, so a long list shows more of itself. */
  isCompact?: boolean;
};

function Entry({ entry, onClose, isCompact = false }: EntryProps) {
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
            collisionPadding={EDGE_CLEARANCE}
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
      // Under a coarse pointer a row's button reaches past the row, and that would make the list scroll.
      className={cn(menuItemClasses, isCompact && 'min-h-12', actions.length > 0 && 'overflow-hidden')}
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

/** Every row, unseen and with no height, so narrowing the list leaves the menu as wide as it opened. */
function WidthOfAllRows({ entries }: { entries: MenuEntry[] }) {
  return (
    <div aria-hidden className="invisible h-0 overflow-y-scroll">
      {entries.map((entry, index) => {
        if (entry.kind === 'label') {
          return (
            <div key={index} className={menuLabelClasses}>
              <Text variant="meta">{entry.label}</Text>
            </div>
          );
        }
        if (entry.kind !== 'item') return null;
        return (
          <div key={index} className={menuItemClasses}>
            <MenuRow item={entry} />
            {entry.actions?.map(({ label }) => (
              <span key={label} className="-mx-1 size-8 shrink-0" />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function focusSearch(event: Event): void {
  event.preventDefault();
  if (event.currentTarget instanceof Element) event.currentTarget.querySelector('input')?.focus();
}

// The menu would otherwise take each letter as a jump to a row. Esc still closes it, and the down arrow goes to the list.
function keepKeysInSearch(event: KeyboardEvent<HTMLDivElement>): void {
  if (event.key === 'Escape') return;
  event.stopPropagation();
  if (event.key !== 'ArrowDown') return;
  event.preventDefault();
  event.currentTarget.parentElement?.querySelector<HTMLElement>('[role="menuitem"]:not([data-disabled])')?.focus();
}

// Pointing at a row takes focus from the field, and typing should still search.
function typeIntoSearch(event: KeyboardEvent<HTMLDivElement>): void {
  if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
  event.stopPropagation();
  event.currentTarget.querySelector('input')?.focus();
}

export function DropdownMenu({
  entries,
  align = 'end',
  side = 'bottom',
  footer,
  searchLabel,
  className,
  children,
  ...triggerProps
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const close = () => setIsOpen(false);
  const changeOpen = (open: boolean) => {
    setIsOpen(open);
    if (open) setQuery('');
  };
  const wanted = query.trim().toLowerCase();
  const shown =
    wanted === ''
      ? entries
      : entries.filter(
          (entry) => entry.kind === 'item' && `${entry.label} ${entry.shortcut ?? ''}`.toLowerCase().includes(wanted),
        );

  return (
    <RadixDropdownMenu.Root open={isOpen} onOpenChange={changeOpen}>
      <RadixDropdownMenu.Trigger asChild {...triggerProps}>
        {children}
      </RadixDropdownMenu.Trigger>
      <RadixDropdownMenu.Portal>
        <RadixDropdownMenu.Content
          align={align}
          side={side}
          collisionPadding={EDGE_CLEARANCE}
          {...(searchLabel === undefined ? {} : { onOpenAutoFocus: focusSearch, onKeyDownCapture: typeIntoSearch })}
          className={cn(
            menuContentClasses,
            'origin-(--radix-dropdown-menu-content-transform-origin)',
            'data-[side=bottom]:mt-1 data-[side=left]:mr-1 data-[side=right]:ml-1 data-[side=top]:mb-1',
            footer ? 'flex max-h-(--radix-dropdown-menu-content-available-height) flex-col' : LONG_MENU_SCROLLS,
            className,
          )}
        >
          {footer ? (
            <>
              {searchLabel === undefined ? null : (
                <div className="shrink-0 pb-1" onKeyDown={keepKeysInSearch}>
                  <SearchInput value={query} onValueChange={setQuery} label={searchLabel} />
                </div>
              )}
              {searchLabel === undefined ? null : <WidthOfAllRows entries={entries} />}
              <div
                className={cn(
                  'min-h-0 overflow-y-auto',
                  searchLabel === undefined ? 'max-h-96' : 'max-h-[60vh] [scrollbar-gutter:stable]',
                )}
              >
                {shown.map((entry, index) => (
                  <Entry key={index} entry={entry} onClose={close} isCompact={searchLabel !== undefined} />
                ))}
                {shown.length === 0 ? (
                  <div className={menuLabelClasses}>
                    <Text variant="meta" color="muted">
                      Nothing by that name
                    </Text>
                  </div>
                ) : null}
              </div>
              <RadixDropdownMenu.Separator className={menuSeparatorClasses} />
              {footer.map((entry, index) => (
                <Entry key={index} entry={entry} onClose={close} isCompact={searchLabel !== undefined} />
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
