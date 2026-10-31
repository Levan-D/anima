import { Switch as RadixSwitch } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Props = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  /** What it does. The whole row is the target, so it stays big enough for a finger however small the switch looks. */
  children: ReactNode;
  className?: string;
};

export function Switch({ checked, onCheckedChange, disabled = false, children, className }: Props) {
  return (
    <label className={cn('flex min-h-tap min-w-0 items-center gap-3 select-none has-disabled:opacity-40', className)}>
      {children}
      <RadixSwitch.Root
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="relative h-6 w-10 shrink-0 rounded-full bg-surface-active transition-colors duration-(--dur-fast) ease-standard data-[state=checked]:bg-accent"
      >
        <RadixSwitch.Thumb className="block size-5 translate-x-0.5 rounded-full bg-text transition-[translate,background-color] duration-(--dur-fast) ease-standard data-[state=checked]:translate-x-4.5 data-[state=checked]:bg-on-accent" />
      </RadixSwitch.Root>
    </label>
  );
}
