import { useQuery } from '@tanstack/react-query';
import { WANDER_MIDDLE } from '@shared/domain';
import { Divider } from '@/components/ui/Divider';
import { Modal } from '@/components/ui/Modal';
import { settingsQuery } from '@/lib/libraryQueries';
import { openSettings } from '@/lib/pages';
import { setRadioWander } from '@/lib/playerActions';
import { useRadioSlider } from '@/features/Radio/hooks/useRadioSlider';
import { EnergySection } from './EnergySection';
import { RadioSliderSection } from './RadioSliderSection';
import { SeasonsLine } from './SeasonsLine';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** How radio behaves once it's playing, which is set now and then rather than each time. */
export function RadioSettings({ open, onOpenChange }: Props) {
  const saved = useQuery({ ...settingsQuery, select: (settings) => settings.radioWander });
  const wander = useRadioSlider(saved.data ?? WANDER_MIDDLE, setRadioWander);

  function goTo(page: 'data' | 'seasons'): void {
    onOpenChange(false);
    openSettings(page);
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Radio settings" closeLabel="Close radio settings">
      <div data-testid="radio-settings" className="flex min-h-0 flex-col overflow-x-hidden overflow-y-auto pb-gutter">
        <RadioSliderSection
          title="Wander"
          description="How far radio may drift from the sound it started on. Low stays on one vibe, high turns up things you might not expect. Started from a genre, it never leaves that genre"
          label="How far radio may wander"
          low="Same vibe"
          high="Adventurous"
          slider={wander}
        />
        <Divider />
        <EnergySection onOpenSettings={() => goTo('data')} />
        <Divider />
        <SeasonsLine onOpenSettings={() => goTo('seasons')} />
      </div>
    </Modal>
  );
}
