import { Minus, Plus } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Tooltip } from '@/components/ui/Tooltip';

type Props = {
  name: string;
  /** The value in words, also what can be typed over. */
  value: string;
  onLower: () => void;
  onRaise: () => void;
  /** With what was typed. What doesn't read as a number is dropped, and the value goes back. */
  onType: (text: string) => void;
  disabled?: boolean;
  /** Short, for what's said in the tooltip when that isn't just the name. */
  hint?: string;
  'data-testid'?: string;
};

/** A value with a step either side, that can also be typed. Wide enough for the longest of them, "+12.0 dB". */
export function ValueStepper({
  name,
  value,
  onLower,
  onRaise,
  onType,
  disabled = false,
  hint = name,
  'data-testid': testId,
}: Props) {
  const [typing, setTyping] = useState<string | null>(null);

  function commit(): void {
    if (typing !== null && typing !== value) onType(typing);
    setTyping(null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') commit();
  }

  return (
    <Tooltip label={hint}>
      <div className="flex h-8 items-center rounded-md border border-outline has-disabled:opacity-40">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Lower ${name}`}
          className="h-full"
          disabled={disabled}
          onClick={onLower}
        >
          <Minus aria-hidden />
        </Button>
        <Input
          aria-label={name}
          isSmall
          data-testid={testId}
          spellCheck={false}
          disabled={disabled}
          value={typing ?? value}
          onFocus={(event) => {
            setTyping(value);
            event.currentTarget.select();
          }}
          onChange={(event) => setTyping(event.currentTarget.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
          className="w-24 bg-transparent px-0 text-center tabular-nums"
        />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Raise ${name}`}
          className="h-full"
          disabled={disabled}
          onClick={onRaise}
        >
          <Plus aria-hidden />
        </Button>
      </div>
    </Tooltip>
  );
}
