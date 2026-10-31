import { EqButton } from '@/features/Transport/components/EqButton';
import { ExclusiveSwitch } from '@/features/Transport/components/ExclusiveSwitch';
import { MuteButton } from '@/features/Transport/components/MuteButton';
import { PlayButtons } from '@/features/Transport/components/PlayButtons';
import { PlayerProblem } from '@/features/Transport/components/PlayerProblem';
import { Seekbar } from '@/features/Transport/components/Seekbar';
import { SignalStatus } from '@/features/Transport/components/SignalStatus';
import { SoundMenu } from '@/features/Transport/components/SoundMenu';
import { TrackInfo } from '@/features/Transport/components/TrackInfo';
import { VolumeSlider } from '@/features/Transport/components/VolumeSlider';
import { usePlayer } from '@/lib/playerStore';

/**
 * What's playing and how to change it, at the bottom of the list column. It goes by its own width, in `em` so it follows
 * the type: too narrow and the sound controls fold into a menu, wide enough and everything sits on one row. Some parts
 * are in the tree twice for that, and CSS shows one of them.
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
      <div className="flex items-center gap-gap">
        {hasProblem ? <PlayerProblem /> : <TrackInfo />}
        <SignalStatus className="hidden shrink-0 @transport-line:flex" />
      </div>

      <Seekbar />

      <div className="flex items-center gap-x-gap">
        <PlayButtons />
        <MuteButton className="ml-auto @transport:ml-0" />
        <VolumeSlider className="hidden flex-1 @transport:flex @transport-line:max-w-60" />
        <EqButton />
        <SoundMenu className="@transport:hidden" />
        <ExclusiveSwitch className="ml-auto hidden @transport-line:flex" />
      </div>

      <div className="hidden items-center justify-between gap-x-gap @transport:flex @transport-line:hidden">
        <SignalStatus className="flex min-w-0" />
        <ExclusiveSwitch className="flex shrink-0" />
      </div>
    </section>
  );
}
