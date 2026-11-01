import { EqButton } from '@/features/Transport/components/EqButton';
import { ExclusiveButton } from '@/features/Transport/components/ExclusiveButton';
import { MiniPlayerButton } from '@/features/Transport/components/MiniPlayerButton';
import { MuteButton } from '@/features/Transport/components/MuteButton';
import { PlayButtons } from '@/features/Transport/components/PlayButtons';
import { PlayerProblem } from '@/features/Transport/components/PlayerProblem';
import { QueueButton } from '@/features/Transport/components/QueueButton';
import { Seekbar } from '@/features/Transport/components/Seekbar';
import { SignalButton } from '@/features/Transport/components/SignalButton';
import { SoundMenu } from '@/features/Transport/components/SoundMenu';
import { TrackInfo } from '@/features/Transport/components/TrackInfo';
import { VolumeSlider } from '@/features/Transport/components/VolumeSlider';
import { usePlayer } from '@/lib/playerStore';

/**
 * What's playing and how to change it, at the bottom of the list column. It goes by its own width, in `em` so it follows
 * the type: too narrow for a usable volume slider and only that and mute fold into a menu, which is why they're in the
 * tree twice. A page that gives it the whole window's width can declare a `page` container, and then it lies flat.
 */
export function Transport() {
  const hasProblem = usePlayer((state) => state.status === 'error' || state.status === 'unavailable');

  return (
    <section
      aria-label="Now playing"
      data-testid="transport"
      // The fade is so the list goes under this instead of being cut off by it.
      className="@container relative flex flex-col px-gutter pt-gutter pb-transport-end before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-list-fade before:bg-linear-to-t before:from-bg before:to-transparent @wide/page:flex-row @wide/page:items-center @wide/page:gap-section"
    >
      <div className="flex min-w-0 items-center gap-gap @wide/page:w-1/4">
        {hasProblem ? <PlayerProblem /> : <TrackInfo />}
      </div>

      <Seekbar className="@wide/page:mt-0 @wide/page:min-w-0 @wide/page:flex-1" />

      <div className="@wide/page:w-1/3 @wide/page:shrink-0">
        {/* No gaps when folded: the narrowest column has room for its six 44px buttons and little more. */}
        <div className="flex items-center @transport:gap-x-gap">
          <PlayButtons />
          <MuteButton className="ml-auto hidden @transport:inline-flex" />
          <VolumeSlider className="hidden flex-1 @transport:flex @transport:max-w-60" />
          <EqButton className="ml-auto @transport:ml-0" />
          <QueueButton />
        </div>

        <div className="flex items-center gap-x-gap">
          <SignalButton />
          <div className="ml-auto flex shrink-0 items-center">
            <SoundMenu className="@transport:hidden" />
            <ExclusiveButton />
            <MiniPlayerButton />
          </div>
        </div>
      </div>
    </section>
  );
}
