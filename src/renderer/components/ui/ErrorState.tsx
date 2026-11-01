import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { AppFailure } from '@/lib/api';
import { cn } from '@/lib/cn';

const UNEXPECTED_MESSAGE = 'Something went wrong here.';

type Props = {
  error: unknown;
  onRetry?: () => void;
  className?: string;
};

export function ErrorState({ error, onRetry, className }: Props) {
  const message = error instanceof AppFailure ? error.message : UNEXPECTED_MESSAGE;

  return (
    <div
      role="alert"
      className={cn(
        'content-in flex size-full flex-col items-center justify-center gap-gap p-gutter text-center',
        className,
      )}
    >
      <Text as="p" color="muted">
        {message}
      </Text>
      {onRetry ? <Button onClick={() => onRetry()}>Try again</Button> : null}
    </div>
  );
}
