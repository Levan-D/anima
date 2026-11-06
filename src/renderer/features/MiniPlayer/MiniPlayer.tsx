import { Maximize2, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { AlbumArt } from '@/components/music/AlbumArt';
import { SoundButton } from '@/components/music/SoundButton';
import { Button } from '@/components/ui/Button';
import { IconSwap } from '@/components/ui/IconSwap';
import { Swap } from '@/components/ui/Swap';
import { Text } from '@/components/ui/Text';
import { MiniProgress } from '@/features/MiniPlayer/components/MiniProgress';
import { MiniTime } from '@/features/MiniPlayer/components/MiniTime';
import { useMiniNotice } from '@/features/MiniPlayer/hooks/useMiniNotice';
import { playNextTrack, playPreviousTrack, togglePlaying } from '@/lib/playerActions';
import { usePlayer } from '@/lib/playerStore';
import { setMiniPlayer } from '@/lib/windowActions';

const RETURN_LABEL = 'Return to the main window';

function returnToMainWindow(): void {
  setMiniPlayer(false);
}

/** The whole window: a strip, in which everything that isn't a control drags it. */
export function MiniPlayer() {
  const title = usePlayer((state) => state.current?.title ?? 'Nothing playing');
  const artist = usePlayer((state) => state.current?.artist ?? '');
  const artHash = usePlayer((state) => state.current?.artHash ?? null);
  const problem = usePlayer((state) => state.error?.message ?? null);
  const isOn = usePlayer((state) => state.status === 'playing' || state.status === 'loading');
  const hasQueue = usePlayer((state) => state.queueLength > 0 && state.status !== 'unavailable');
  const hasCurrent = usePlayer((state) => state.current !== null && state.status !== 'unavailable');
  const playLabel = isOn ? 'Pause' : 'Play';
  const notice = useMiniNotice();
  const message = notice?.message ?? problem;
  const isAlarming = notice === null || notice.level === 'error';

  return (
    <section
      aria-label="Mini player"
      data-testid="mini-player"
      className="relative flex size-full items-center overflow-hidden drag"
    >
      <Button
        variant="ghost"
        size="bare"
        aria-label={RETURN_LABEL}
        title={RETURN_LABEL}
        onClick={returnToMainWindow}
        className="aspect-square h-full rounded-none focus-inset no-drag active:scale-100 [&>span]:block [&>span]:size-full"
      >
        <AlbumArt hash={artHash} title={title} className="size-full rounded-none" />
      </Button>

      <div className="flex min-w-0 flex-1 flex-col px-gap">
        <Text as="h1" variant="lead" truncate title={title} data-testid="mini-title">
          {title}
        </Text>
        <div className="flex min-w-0 items-baseline gap-gap">
          <Swap id={message === null ? 'artist' : 'message'} className="min-w-0 flex-1" innerClassName="flex min-w-0">
            {message === null ? (
              <Text
                as="p"
                variant="meta"
                color="muted"
                truncate
                title={artist}
                data-testid="mini-artist"
                className="min-h-lh min-w-0 flex-1"
              >
                {artist}
              </Text>
            ) : (
              <Text
                as="p"
                role="status"
                variant="meta"
                color={isAlarming ? 'danger' : 'default'}
                truncate
                title={message}
                data-testid="mini-message"
                className="min-w-0 flex-1"
              >
                {message}
              </Text>
            )}
          </Swap>
          <MiniTime />
        </div>
      </div>

      <div className="flex shrink-0 items-center pr-1 no-drag">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Previous"
          title="Previous"
          disabled={!hasCurrent}
          onClick={playPreviousTrack}
          className="[&_svg]:fill-current"
        >
          <SkipBack aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={playLabel}
          title={playLabel}
          disabled={!hasQueue}
          onClick={togglePlaying}
          className="text-text [&_svg]:fill-current"
        >
          <IconSwap id={playLabel}>{isOn ? <Pause aria-hidden /> : <Play aria-hidden />}</IconSwap>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Next"
          title="Next"
          disabled={!hasCurrent}
          onClick={playNextTrack}
          className="[&_svg]:fill-current"
        >
          <SkipForward aria-hidden />
        </Button>
        {/* To the left, since nothing can leave the window and the strip has no room above a button. */}
        <SoundButton side="left" />
        <Button variant="ghost" size="icon" aria-label={RETURN_LABEL} title={RETURN_LABEL} onClick={returnToMainWindow}>
          <Maximize2 aria-hidden />
        </Button>
      </div>

      <MiniProgress />
    </section>
  );
}
