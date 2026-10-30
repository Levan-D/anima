import type { ReactNode } from 'react';
import { ListSkeleton } from '@/components/music/ListSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { useIsScanning } from '@/lib/libraryQueries';

type Props = {
  title: string;
  description: string;
  skeleton: 'rows' | 'grid';
  /** What to do about it. */
  action: ReactNode;
};

/** A list with nothing in it. While a scan runs that only means nothing has been found yet. */
export function ListEmpty({ title, description, skeleton, action }: Props) {
  const isScanning = useIsScanning();
  if (isScanning) return <ListSkeleton kind={skeleton} />;

  return <EmptyState title={title} description={description} action={action} />;
}
