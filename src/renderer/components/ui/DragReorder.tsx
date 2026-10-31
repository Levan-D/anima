import { GripVertical } from 'lucide-react';
import type { ReactNode } from 'react';
import { useDragReorder } from '@/hooks/useDragReorder';

type Props = {
  /** Every row in the list that takes part, in order, each marked with `data-drag-id`. */
  ids: readonly number[];
  /** `toIndex` is where they start, counted in the list without them. */
  onMove: (ids: number[], toIndex: number) => void;
  /** What goes along with a row when it's picked up, itself included. Leave out for just the row. */
  movingWith?: (id: number) => number[];
  children: ReactNode;
};

/** Around a list whose rows can be dragged to reorder them. Takes the place of the list in a flex column. */
export function DragReorder({ ids, onMove, movingWith, children }: Props) {
  const { containerRef, indicatorRef, handlers } = useDragReorder({ ids, onMove, movingWith });

  return (
    <div
      ref={containerRef}
      {...handlers}
      className="relative flex min-h-0 flex-1 flex-col data-reordering:cursor-grabbing"
    >
      {children}
      <div
        ref={indicatorRef}
        hidden
        data-testid="drop-line"
        className="pointer-events-none absolute inset-x-gutter top-0 z-10 h-0.5 rounded-full bg-accent"
      />
    </div>
  );
}

/** For a row that can't be picked up, in a list where others can, so the columns still line up. */
export function DragHandleSpace() {
  return <span aria-hidden className="-ml-gutter size-tap shrink-0" />;
}

/** Where a finger picks a row up. It isn't a button: the keyboard has Move up and Move down in the menu. */
export function DragHandle() {
  return (
    <span
      data-drag-handle
      aria-hidden
      className="-ml-gutter flex size-tap shrink-0 cursor-grab touch-none items-center justify-center text-text-faint"
    >
      <GripVertical />
    </span>
  );
}
