import { Radio } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { setRadio } from '@/lib/playerActions';
import { usePlayer } from '@/lib/playerStore';

type Props = {
  className?: string;
};

/** The same switch as the one in the sound menu, for a column wide enough not to fold that away. */
export function RadioButton({ className }: Props) {
  const isOn = usePlayer((state) => state.radio);

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Radio"
      aria-pressed={isOn}
      title={isOn ? 'Radio is on' : 'Radio: keeps the queue going'}
      className={cn(isOn && 'text-accent', className)}
      onClick={() => setRadio(!isOn)}
    >
      <Radio aria-hidden />
    </Button>
  );
}
