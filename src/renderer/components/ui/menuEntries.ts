import type { LucideIcon } from 'lucide-react';

/** A button at the row's end, for what's about that row rather than choosing it. */
export type MenuRowAction = {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
};

export type MenuItem = {
  kind: 'item';
  label: string;
  icon?: LucideIcon;
  shortcut?: string;
  destructive?: boolean;
  disabled?: boolean;
  /** The one of several that's chosen now. */
  isCurrent?: boolean;
  action?: MenuRowAction;
  onSelect: () => void;
};

export type MenuSubmenu = {
  kind: 'submenu';
  label: string;
  icon?: LucideIcon;
  disabled?: boolean;
  entries: MenuEntry[];
};

export type MenuEntry = MenuItem | MenuSubmenu | { kind: 'separator' } | { kind: 'label'; label: string };

export const menuContentClasses =
  'z-50 min-w-64 rounded-lg border border-border bg-surface-raised p-1 no-drag shadow-xl outline-hidden pop';

// Hovering also moves real focus here, and from nowhere that counts as :focus-visible. The mouse gets just the fill.
export const menuItemClasses =
  'flex min-h-tap items-center gap-3 rounded-md px-3 select-none focus-inset hover:outline-hidden data-disabled:opacity-40 data-highlighted:bg-surface-hover [&_svg]:size-5 [&_svg]:shrink-0';

export const menuSeparatorClasses = 'mx-1 my-1 h-px bg-border';

export const menuLabelClasses = 'px-3 py-2';
