import { AlbumArt } from '@/components/music/AlbumArt';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';

type Props = {
  artHash: string | null;
  /** What a cover with no art says, when it isn't the name, such as a song's album. */
  artTitle?: string;
  name: string;
  /** Smaller, at the end: whose it is, or what kind of pick. */
  aside: string;
  disabled?: boolean;
  onPick: () => void;
};

/** One row of a Radio picker. */
export function PickRow({ artHash, artTitle, name, aside, disabled = false, onPick }: Props) {
  return (
    <Button variant="row" size="row" className="h-row" disabled={disabled} onClick={onPick}>
      <AlbumArt hash={artHash} title={artTitle ?? name} className="size-8 shrink-0" />
      <Text truncate className="min-w-0 flex-1">
        {name}
      </Text>
      <Text variant="meta" color="muted" truncate className="max-w-1/2 min-w-0 shrink-0">
        {aside}
      </Text>
    </Button>
  );
}
