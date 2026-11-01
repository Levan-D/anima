import { EqButton } from '@/features/Transport/components/EqButton';
import { ExclusiveButton } from '@/features/Transport/components/ExclusiveButton';
import { MiniPlayerButton } from '@/features/Transport/components/MiniPlayerButton';
import { MuteButton } from '@/features/Transport/components/MuteButton';
import { PlayButtons } from '@/features/Transport/components/PlayButtons';
import { PlayerProblem } from '@/features/Transport/components/PlayerProblem';
import { RadioButton } from '@/features/Transport/components/RadioButton';
import { Seekbar } from '@/features/Transport/components/Seekbar';
import { SignalButton } from '@/features/Transport/components/SignalButton';
import { SoundMenu } from '@/features/Transport/components/SoundMenu';
import { TrackInfo } from '@/features/Transport/components/TrackInfo';
import { VolumeSlider } from '@/features/Transport/components/VolumeSlider';
import { usePlayer } from '@/lib/playerStore';

/**
 * What's playing and how to change it, at the bottom of the list column. It goes by its own width, in `em` so it follows
 * the type: too narrow for a usable volume slider and only that folds into a menu, which is why it's in the tree twice.
 */
export function Transport() {
  const hasProblem = usePlayer((state) => state.status === 'error' || state.status === 'unavailable');

  return (
    <section
      aria-label="Now playing"
      data-testid="transport"
      // The fade is so the list goes under this instead of being cut off by it.
      className="@container relative px-gutter pt-gutter pb-transport-end before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-list-fade before:bg-linear-to-t before:from-bg before:to-transparent"
    >
      <div className="flex items-center gap-gap">{hasProblem ? <PlayerProblem /> : <TrackInfo />}</div>

      <Seekbar />

      {/* No gaps when folded: the narrowest column has room for its six 44px buttons and little more. */}
      <div className="flex items-center @transport:gap-x-gap">
        <PlayButtons />
        <MuteButton className="ml-auto" />
        <VolumeSlider className="hidden flex-1 @transport:flex @transport:max-w-60" />
        <EqButton />
      </div>

      <div className="flex items-center gap-x-gap">
        <SignalButton />
        <div className="ml-auto flex shrink-0 items-center">
          <SoundMenu className="@transport:hidden" />
          <RadioButton />
          <ExclusiveButton />
          <MiniPlayerButton />
        </div>
      </div>
    </section>
  );
}
