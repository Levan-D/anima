import { AudioLines } from 'lucide-react';
import { useEqPresetChoices } from '@/components/music/useEqPresetChoices';
import { Button } from '@/components/ui/Button';
import { DropdownMenu } from '@/components/ui/DropdownMenu';
import type { MenuEntry } from '@/components/ui/menuEntries';
import { Tooltip } from '@/components/ui/Tooltip';
import { cn } from '@/lib/cn';
import { setEqualizerOpen } from '@/lib/equalizerDialog';
import { goBack } from '@/lib/navigation';
import { usePlayer } from '@/lib/playerStore';

const EDIT_PRESETS: MenuEntry[] = [{ kind: 'item', label: 'Edit presets', onSelect: () => setEqualizerOpen(true) }];

type Props = {
  className?: string;
};

/** Up from the transport: which preset is playing, and the way to the equalizer. On shows in the icon's own color. */
export function EqButton({ className }: Props) {
  const isOn = usePlayer((state) => state.eq.enabled);
  const choices = useEqPresetChoices();

  return (
    <DropdownMenu entries={choices} footer={EDIT_PRESETS} side="top">
      <Tooltip label="Equalizer" onEscape={goBack}>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Equalizer"
          className={cn(isOn && 'text-accent hover:text-accent', className)}
        >
          <AudioLines aria-hidden />
        </Button>
      </Tooltip>
    </DropdownMenu>
  );
}
