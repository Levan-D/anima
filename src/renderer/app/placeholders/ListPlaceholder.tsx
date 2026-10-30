import { useState } from 'react';
import { Skeleton } from '@/components/ui/Skeleton';
import { Tabs } from '@/components/ui/Tabs';

const VIEWS = [
  { value: 'albums', label: 'Albums' },
  { value: 'artists', label: 'Artists' },
  { value: 'genres', label: 'Genres' },
  { value: 'tracks', label: 'Tracks' },
  { value: 'playlists', label: 'Playlists' },
  { value: 'queue', label: 'Queue' },
];

const ROWS = Array.from({ length: 40 }, (_, index) => index);

function SkeletonRow() {
  return (
    <div data-testid="list-row" className="flex h-row shrink-0 items-center gap-gap px-gutter">
      <Skeleton className="size-10 rounded-sm" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Skeleton className="h-3 w-3/5" />
        <Skeleton className="h-2.5 w-2/5" />
      </div>
      <Skeleton className="h-2.5 w-8" />
    </div>
  );
}

export function ListPlaceholder() {
  const [view, setView] = useState('albums');

  return (
    <Tabs label="Library views" items={VIEWS} value={view} onValueChange={setView} className="min-h-0 flex-1">
      <div data-testid="list-scroller" className="flex min-h-0 flex-1 flex-col overflow-y-auto focus-inset">
        {ROWS.map((row) => (
          <SkeletonRow key={row} />
        ))}
      </div>
    </Tabs>
  );
}
