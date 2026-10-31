import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Text } from '@/components/ui/Text';
import { useHotkeys } from '@/features/Hotkeys/hooks/useHotkeys';

const KEYS: readonly (readonly [string, string])[] = [
  ['Space', 'Play or pause'],
  ['Left, Right', 'Seek 5 seconds'],
  ['Shift + Left, Right', 'Seek 30 seconds'],
  ['Ctrl + Left, Right', 'Previous, next track'],
  ['+, -', 'Volume'],
  ['M', 'Mute'],
  ['Ctrl + F, /', 'Search'],
  ['Esc', 'Back or close'],
  ['Q', 'Queue'],
  ['L', 'Lyrics'],
  ['E', 'Equalizer'],
  ['Ctrl + ,', 'Settings'],
  ['F11', 'Fullscreen'],
  ['Ctrl + M', 'Mini player'],
  ['Ctrl + Shift + E', 'Exclusive mode'],
  ['Ctrl + =, -', 'Interface size'],
  ['Ctrl + 0', 'Reset interface size'],
  ['Ctrl + A', 'Select all tracks'],
  ['Ctrl + click', 'Select a track'],
  ['Shift + click, Up, Down', 'Extend the selection'],
  ['?', 'This list'],
];

type Props = {
  windowKind: 'main' | 'mini';
};

export function Hotkeys({ windowKind }: Props) {
  const { isHelpOpen, setHelpOpen } = useHotkeys(windowKind);

  return (
    <Dialog
      open={isHelpOpen}
      onOpenChange={setHelpOpen}
      title="Keyboard shortcuts"
      actions={<Button variant="secondary">Close</Button>}
    >
      <ul data-testid="hotkey-list" className="flex flex-col">
        {KEYS.map(([keys, what]) => (
          <li key={keys} className="flex justify-between gap-gap">
            <Text>{keys}</Text>
            <Text color="muted">{what}</Text>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
