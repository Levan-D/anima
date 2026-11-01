import { Minus, Plus } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Hint } from '@/components/ui/Hint';
import { Input } from '@/components/ui/Input';
import { Text } from '@/components/ui/Text';

type Props = {
  name: string;
  /** The value in words, also what can be typed over. */
  value: string;
  onLower: () => void;
  onRaise: () => void;
  /** With what was typed. What doesn't read as a number is dropped, and the value goes back. */
  onType: (text: string) => void;
  disabled?: boolean;
  /** Leave it out when the name beside it is already said nearby. */
  isNameVisible?: boolean;
  /** What the name means, when it's a term. */
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
  isNameVisible = true,
  hint,
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
    <div className="flex items-center gap-1.5">
      {/* Over the minus's touch area, which reaches this far on a coarse pointer. */}
      {isNameVisible && hint !== undefined ? (
        <Hint label={hint} className="relative z-10">
          {name}
        </Hint>
      ) : null}
      {isNameVisible && hint === undefined ? (
        <Text variant="meta" color="muted">
          {name}
        </Text>
      ) : null}
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
    </div>
  );
}
