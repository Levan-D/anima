import { Text } from '@/components/ui/Text';

type Props = {
  title: string;
  subtitle: string;
};

/** Apart from the card, because the grid measures how tall this is to work out its rows. */
export function AlbumCardText({ title, subtitle }: Props) {
  return (
    <span className="flex min-w-0 flex-col pt-2">
      <Text truncate>{title}</Text>
      <Text variant="meta" color="muted" truncate className="min-h-lh">
        {subtitle}
      </Text>
    </span>
  );
}
