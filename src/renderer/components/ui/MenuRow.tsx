import { ChevronRight } from 'lucide-react';
import type { MenuItem, MenuSubmenu } from '@/components/ui/menuEntries';
import { Text } from '@/components/ui/Text';

type Props = {
  item: MenuItem;
};

export function MenuRow({ item: { label, icon: Icon, shortcut, destructive = false } }: Props) {
  return (
    <>
      {Icon ? <Icon aria-hidden className={destructive ? 'text-danger' : 'text-text-muted'} /> : null}
      <Text truncate color={destructive ? 'danger' : 'default'} className="flex-1">
        {label}
      </Text>
      {shortcut ? (
        <Text variant="meta" color="muted">
          {shortcut}
        </Text>
      ) : null}
    </>
  );
}

type SubmenuRowProps = {
  item: MenuSubmenu;
};

export function SubmenuRow({ item: { label, icon: Icon } }: SubmenuRowProps) {
  return (
    <>
      {Icon ? <Icon aria-hidden className="text-text-muted" /> : null}
      <Text truncate className="flex-1">
        {label}
      </Text>
      <ChevronRight aria-hidden className="text-text-muted" />
    </>
  );
}
