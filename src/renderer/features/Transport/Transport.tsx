import type { ReactNode } from 'react';
import { Swap } from '@/components/ui/Swap';
import { EqButton } from '@/features/Transport/components/EqButton';
import { ExclusiveButton } from '@/features/Transport/components/ExclusiveButton';
import { MiniPlayerButton } from '@/features/Transport/components/MiniPlayerButton';
import { MuteButton } from '@/features/Transport/components/MuteButton';
import { PlayButtons } from '@/features/Transport/components/PlayButtons';
import { PlayerProblem } from '@/features/Transport/components/PlayerProblem';
import { QueueButton } from '@/features/Transport/components/QueueButton';
import { SoundButton } from '@/components/music/SoundButton';
import { Seekbar } from '@/features/Transport/components/Seekbar';
import { SignalButton } from '@/features/Transport/components/SignalButton';
import { TrackInfo } from '@/features/Transport/components/TrackInfo';
import { VolumeSlider } from '@/features/Transport/components/VolumeSlider';
import { letGoOfFocus } from '@/features/Transport/utils/letGoOfFocus';
import { usePlayer } from '@/lib/playerStore';

type Props = {
  /** A page's own button, at the top right. Composed by the page, since it belongs to another feature. */
  action?: ReactNode;
};

/**
 * What's playing and how to change it, at the bottom of the list column. It goes by its own width, in `em` so it follows
 * the type: too narrow for a usable volume slider and those two give way to a button that shows it on hover, which is why
 * the sound is in the tree twice. A full-width page puts it in a centered column.
 */
export function Transport({ action }: Props) {
  const hasProblem = usePlayer((state) => state.status === 'error' || state.status === 'unavailable');

  return (
    <section
      aria-label="Now playing"
      data-testid="transport"
      // The fade is so the list goes under this instead of being cut off by it.
      onPointerUp={letGoOfFocus}
      className="@container relative flex flex-col px-gutter pt-gutter pb-transport-end before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-list-fade before:bg-linear-to-t before:from-bg before:to-transparent @max-md/column:pt-2 @max-md/column:pb-2"
    >
      <div className="flex items-start gap-gap">
        <Swap
          id={hasProblem ? 'problem' : 'track'}
          className="min-w-0 flex-1"
          innerClassName="flex min-w-0 items-center gap-gap"
        >
          {hasProblem ? <PlayerProblem /> : <TrackInfo />}
        </Swap>
        {action}
      </div>

      <Seekbar />

      <div>
        {/* No gaps when narrow: the narrowest column has room for its six 44px buttons and little more. */}
        <div className="flex items-center @transport:gap-x-gap">
          <PlayButtons />
          <MuteButton className="ml-auto hidden @transport:inline-flex" />
          <VolumeSlider className="hidden flex-1 @transport:flex @transport:max-w-60" />
          <EqButton className="ml-auto @transport:ml-0" />
          <QueueButton />
        </div>

        <div className="flex items-center gap-x-gap">
          <SignalButton />
          <div className="ml-auto flex shrink-0 items-center @transport:gap-x-gap">
            <SoundButton className="@transport:hidden" />
            <ExclusiveButton />
            <MiniPlayerButton />
          </div>
        </div>
      </div>
    </section>
  );
}
