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
import { TrackHeading } from '@/features/Transport/components/TrackHeading';
import { VolumeSlider } from '@/features/Transport/components/VolumeSlider';
import { usePlayer } from '@/lib/playerStore';

/**
 * The transport's parts in one centered column, for a page built around the art: what's playing, the signal, the waveform,
 * and the play controls in the middle of a row with everything else quiet at its edges. Narrow, the controls take a row
 * of their own.
 */
export function CenteredTransport() {
  const hasProblem = usePlayer((state) => state.status === 'error' || state.status === 'unavailable');

  return (
    <section
      aria-label="Now playing"
      data-testid="transport"
      className="@container flex shrink-0 flex-col items-center px-gutter pb-transport-end"
    >
      {hasProblem ? <PlayerProblem /> : <TrackHeading />}
      <SignalButton className="justify-center" />

      <Seekbar className="w-full" />

      <div className="flex w-full flex-wrap items-center @wide:flex-nowrap">
        {/* The floor makes it wrap below the controls when narrow: with none, its zero basis keeps it on their row. */}
        <div className="flex min-w-tap flex-1 items-center gap-x-gap">
          <SoundMenu className="@transport:hidden" />
          <MuteButton className="hidden @transport:inline-flex" />
          <VolumeSlider className="hidden max-w-60 flex-1 @transport:flex" />
        </div>
        {/* The padding gives back the first button's negative margin, which lines it up with a column's left edge. */}
        <div className="order-first flex w-full justify-center pl-3 @wide:order-none @wide:w-auto">
          <PlayButtons />
        </div>
        <div className="flex flex-1 items-center justify-end @transport:gap-x-gap">
          <EqButton />
          <QueueButton />
          <ExclusiveButton />
          <MiniPlayerButton />
        </div>
      </div>
    </section>
  );
}
