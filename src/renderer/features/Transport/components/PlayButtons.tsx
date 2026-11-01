import { Pause, Play, SkipBack, SkipForward, Square } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Tooltip } from '@/components/ui/Tooltip';
import { goBack } from '@/lib/navigation';
import { usePage } from '@/lib/pages';
import { playNextTrack, playPreviousTrack, stopPlayback, togglePlaying } from '@/lib/playerActions';
import { usePlayer } from '@/lib/playerStore';

export function PlayButtons() {
  // While a track loads it's on its way to playing, and that's what the button should stop.
  const isOn = usePlayer((state) => state.status === 'playing' || state.status === 'loading');
  // The Radio page always has something it could play.
  const isRadioPage = usePage() === 'radio';
  const hasQueue = usePlayer((state) => (state.queueLength > 0 || isRadioPage) && state.status !== 'unavailable');
  const hasCurrent = usePlayer((state) => state.current !== null && state.status !== 'unavailable');
  const label = isOn ? 'Pause' : 'Play';

  return (
    <div className="flex items-center">
      <Tooltip label="Previous" onEscape={goBack}>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Previous"
          disabled={!hasCurrent}
          onClick={playPreviousTrack}
          className="-ml-3 [&_svg]:fill-current"
        >
          <SkipBack aria-hidden />
        </Button>
      </Tooltip>
      <Tooltip label={label} onEscape={goBack}>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          disabled={!hasQueue}
          onClick={togglePlaying}
          className="text-text [&_svg]:size-8 [&_svg]:fill-current"
        >
          {isOn ? <Pause aria-hidden /> : <Play aria-hidden />}
        </Button>
      </Tooltip>
      <Tooltip label="Next" onEscape={goBack}>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Next"
          disabled={!hasCurrent}
          onClick={playNextTrack}
          className="[&_svg]:fill-current"
        >
          <SkipForward aria-hidden />
        </Button>
      </Tooltip>
      <Tooltip label="Stop" onEscape={goBack}>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Stop"
          disabled={!hasCurrent}
          onClick={stopPlayback}
          className="[&_svg]:fill-current"
        >
          <Square aria-hidden />
        </Button>
      </Tooltip>
    </div>
  );
}
