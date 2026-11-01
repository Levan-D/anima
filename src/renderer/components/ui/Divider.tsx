import { cn } from '@/lib/cn';

type Props = {
  orientation?: 'horizontal' | 'vertical';
  className?: string;
};

const orientationClasses: Record<NonNullable<Props['orientation']>, string> = {
  horizontal: 'h-px w-full bg-linear-to-r',
  vertical: 'w-px self-stretch bg-linear-to-b',
};

/** The one line between things: full strength in the middle, fading out to nothing at both ends. */
export function Divider({ orientation = 'horizontal', className }: Props) {
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none shrink-0 from-transparent via-divider to-transparent',
        orientationClasses[orientation],
        className,
      )}
    />
  );
}
