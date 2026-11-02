import type { LucideIcon } from 'lucide-react';
import type { ComponentProps } from 'react';
import { Button } from '@/components/ui/Button';
import { IconSwap } from '@/components/ui/IconSwap';
import { Tooltip } from '@/components/ui/Tooltip';
import { cn } from '@/lib/cn';

type Props = Omit<ComponentProps<'button'>, 'children' | 'onClick' | 'aria-label' | 'aria-pressed'> & {
  /** Each is both the name and the tooltip for that state, so keep them short. */
  labelOff: string;
  labelOn: string;
  isOn: boolean;
  onPressedChange: (next: boolean) => void;
  icon: LucideIcon;
  /** For a toggle whose two states look different as well as being lit. */
  iconOn?: LucideIcon;
  /** An open tooltip takes the Escape that closes it. This is for what that Escape should do as well. */
  onEscape?: () => void;
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
};

/** An icon that's on or off, and lit in the accent when it's on, even while the pointer's over it. */
export function IconToggle({
  labelOff,
  labelOn,
  isOn,
  onPressedChange,
  icon,
  iconOn = icon,
  onEscape,
  tooltipSide = 'top',
  className,
  ...props
}: Props) {
  const Icon = isOn ? iconOn : icon;
  const label = isOn ? labelOn : labelOff;

  return (
    <Tooltip label={label} side={tooltipSide} {...(onEscape ? { onEscape } : {})}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={label}
        aria-pressed={isOn}
        className={cn(isOn && 'text-accent hover:text-accent', className)}
        onClick={() => onPressedChange(!isOn)}
        {...props}
      >
        <IconSwap id={iconOn === icon ? 'icon' : String(isOn)}>
          <Icon aria-hidden />
        </IconSwap>
      </Button>
    </Tooltip>
  );
}
