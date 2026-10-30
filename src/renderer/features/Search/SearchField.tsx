import { Search, X } from 'lucide-react';
import { useRef, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/cn';
import { focusCurrentList } from '@/lib/listDom';
import { clearSearch, setSearchQuery, useNavigation } from '@/lib/navigation';

const MAX_LENGTH = 200;

type Props = {
  className?: string;
};

function goToResults(event: KeyboardEvent): void {
  if (event.key !== 'ArrowDown' && event.key !== 'Enter') return;
  if (focusCurrentList()) event.preventDefault();
}

export function SearchField({ className }: Props) {
  const query = useNavigation((state) => state.query);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasQuery = query !== '';

  return (
    <label className={cn('relative flex h-tap min-w-0 items-center py-1', className)}>
      <Search aria-hidden className="pointer-events-none absolute left-3 size-5 text-text-muted" />
      <Input
        ref={inputRef}
        type="search"
        value={query}
        maxLength={MAX_LENGTH}
        placeholder="Search"
        aria-label="Search your library"
        spellCheck={false}
        onChange={(event) => setSearchQuery(event.target.value)}
        onKeyDown={goToResults}
        className={cn(
          'pl-10 focus-inset [&::-webkit-search-cancel-button]:appearance-none',
          hasQuery ? 'pr-10' : 'pr-2',
        )}
      />
      {hasQuery ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Clear search"
          onClick={() => {
            clearSearch();
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
