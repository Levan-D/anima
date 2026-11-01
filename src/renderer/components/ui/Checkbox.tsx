import { Check } from 'lucide-react';
import { Checkbox as RadixCheckbox } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Props = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** What it says. The whole row is the target, so it's big enough for a finger however small the box looks. */
  children: ReactNode;
  className?: string;
};

export function Checkbox({ checked, onCheckedChange, children, className }: Props) {
  return (
    <label className={cn('flex min-h-tap min-w-0 items-center gap-1.5 select-none', className)}>
      <RadixCheckbox.Root
        checked={checked}
        onCheckedChange={(next) => onCheckedChange(next === true)}
        className="flex size-5 shrink-0 items-center justify-center rounded-sm border border-outline transition-colors duration-(--dur-fast) ease-standard data-[state=checked]:border-accent data-[state=checked]:bg-accent"
      >
        <RadixCheckbox.Indicator className="text-on-accent">
          <Check aria-hidden className="size-4" />
        </RadixCheckbox.Indicator>
      </RadixCheckbox.Root>
      {children}
    </label>
  );
}
