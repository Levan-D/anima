import type { KeyboardEvent } from 'react';
import { SearchInput } from '@/components/ui/SearchInput';
import { focusCurrentList } from '@/lib/listDom';
import { setSearchQuery, useNavigation } from '@/lib/navigation';

type Props = {
  className?: string;
};

function goToResults(event: KeyboardEvent): void {
  if (event.key !== 'ArrowDown' && event.key !== 'Enter') return;
  if (focusCurrentList()) event.preventDefault();
}

export function SearchField({ className }: Props) {
  const query = useNavigation((state) => state.query);

  return (
    <SearchInput
      value={query}
      onValueChange={setSearchQuery}
      label="Search your library"
      onKeyDown={goToResults}
      {...(className ? { className } : {})}
    />
  );
}
