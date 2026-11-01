import { Search, X } from 'lucide-react';
import { useRef, type KeyboardEventHandler } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/cn';

const MAX_LENGTH = 200;

type Props = {
  value: string;
  onValueChange: (value: string) => void;
  /** Announced to screen readers: what this searches. */
  label: string;
  placeholder?: string;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  className?: string;
};

export function SearchInput({ value, onValueChange, label, placeholder = 'Search', onKeyDown, className }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hasValue = value !== '';

  return (
    <label className={cn('@container relative flex h-tap min-w-0 items-center py-1', className)}>
      <Search aria-hidden className="pointer-events-none absolute left-3 size-5 text-text-muted" />
      <Input
        ref={inputRef}
        type="search"
        value={value}
        maxLength={MAX_LENGTH}
        placeholder={placeholder}
        aria-label={label}
        spellCheck={false}
        onChange={(event) => onValueChange(event.target.value)}
        {...(onKeyDown ? { onKeyDown } : {})}
        className={cn(
          'pl-10 focus-inset @max-[6em]:placeholder:text-transparent [&::-webkit-search-cancel-button]:appearance-none',
          hasValue ? 'pr-10' : 'pr-2',
        )}
      />
      {hasValue ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Clear search"
          onClick={() => {
            onValueChange('');
            inputRef.current?.focus();
          }}
          className="absolute right-0 hover:bg-transparent [&_svg]:size-5"
        >
          <X aria-hidden />
        </Button>
      ) : null}
    </label>
  );
}
