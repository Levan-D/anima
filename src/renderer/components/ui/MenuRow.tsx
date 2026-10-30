import type { MenuItem } from '@/components/ui/menuEntries';
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
