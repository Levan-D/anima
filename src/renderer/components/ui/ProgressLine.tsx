import type { CSSProperties } from 'react';
import { cn } from '@/lib/cn';

type Props = {
  /** 0 to 1, or null while there's no telling how far along it is. */
  value: number | null;
  label: string;
  className?: string;
};

export function ProgressLine({ value, label, className }: Props) {
  const scale = value === null ? 1 : Math.min(Math.max(value, 0), 1);
  const progress = { '--progress': scale } as CSSProperties;

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={value === null ? undefined : scale}
      className={cn('h-0.5 w-full overflow-hidden bg-surface-hover', className)}
    >
      {value === null ? (
        <div className="h-full w-1/3 animate-sweep bg-accent" />
      ) : (
        <div
          style={progress}
          className="h-full origin-left scale-x-(--progress) bg-accent transition-[scale] duration-(--dur-mid) ease-standard"
        />
      )}
    </div>
  );
}
