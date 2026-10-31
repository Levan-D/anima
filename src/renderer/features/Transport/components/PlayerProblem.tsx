import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { retryPlayback } from '@/lib/playerActions';
import { usePlayer } from '@/lib/playerStore';

/** Where the title goes, because when playback has stopped for a reason, the reason is the thing to read. */
export function PlayerProblem() {
  const message = usePlayer((state) => state.error?.message ?? 'Playback stopped.');

  return (
    <div role="alert" className="flex min-w-0 flex-1 items-center gap-gap">
      <Text as="p" variant="meta" className="line-clamp-3 min-w-0 flex-1 wrap-anywhere select-text">
        {message}
      </Text>
      <Button onClick={retryPlayback}>Retry</Button>
    </div>
  );
}
