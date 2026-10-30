import { Text } from '@/components/ui/Text';

export function ArtPlaceholder() {
  return (
    <div className="@container flex size-full items-end bg-linear-to-br from-surface-active via-surface to-bg p-section">
      <Text as="h1" variant="cover" className="min-w-0">
        Nothing playing
      </Text>
    </div>
  );
}
