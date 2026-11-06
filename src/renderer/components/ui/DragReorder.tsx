import { GripVertical } from 'lucide-react';
import { Component, type ReactNode } from 'react';
import { Text } from '@/components/ui/Text';
import { useDragReorder } from '@/hooks/useDragReorder';
import { cn } from '@/lib/cn';

type Props = {
  /** Every row in the list that takes part, in order, each marked with `data-drag-id`. */
  ids: readonly number[];
  /** `toIndex` is where they start, counted in the list without them. */
  onMove: (ids: number[], toIndex: number) => void;
  /** What goes along with a row when it's picked up, itself included. Leave out for just the row. */
  movingWith?: (id: number) => number[];
  children: ReactNode;
};

type BeforeRowsChangeProps = {
  ids: readonly number[];
  onChange: (after: readonly number[]) => void;
  children: ReactNode;
};

/** A class, since nothing else runs while the rows that are leaving are still there to be copied. */
class BeforeRowsChange extends Component<BeforeRowsChangeProps> {
  override getSnapshotBeforeUpdate(previous: BeforeRowsChangeProps): null {
    if (previous.ids !== this.props.ids) this.props.onChange(this.props.ids);
    return null;
  }

  override componentDidUpdate(): void {}

  override render(): ReactNode {
    return this.props.children;
  }
}

/** Around a list whose rows can be dragged to reorder them. Takes the place of the list in a flex column. */
export function DragReorder({ ids, onMove, movingWith, children }: Props) {
  const { containerRef, overlayRef, liftedRef, copyRef, ghostsRef, beforeRowsChange, movingCount, handlers } =
    useDragReorder({
      ids,
      onMove,
      movingWith,
    });
  const isGroup = movingCount > 1;

  return (
    <div
      ref={containerRef}
      {...handlers}
      className={cn(
        'relative flex min-h-0 flex-1 flex-col',
        'data-reordering:cursor-grabbing [&_[data-drag-id]]:cursor-grab data-reordering:[&_[data-drag-id]]:cursor-grabbing',
        '[&_[data-dragging]]:opacity-0',
        '[&_[data-sliding]]:transition-transform [&_[data-sliding]]:duration-(--dur-mid) [&_[data-sliding]]:ease-standard',
      )}
    >
      <BeforeRowsChange ids={ids} onChange={beforeRowsChange}>
        {children}
      </BeforeRowsChange>
      {/* Clipped to the list, so a row gliding to a place that has scrolled away doesn't cross what's around it. */}
      <div className="pointer-events-none absolute inset-0 z-20 overflow-y-clip">
        <div ref={ghostsRef} inert aria-hidden />
        <div
          ref={overlayRef}
          hidden
          inert
          aria-hidden
          data-testid="drag-overlay"
          className="absolute top-0 will-change-transform"
        >
          <div ref={liftedRef} className="relative size-full">
            <div
              data-raised
              hidden={!isGroup}
              className="absolute inset-x-2 -bottom-1.5 h-full rounded-md bg-surface-hover shadow-xl"
            />
            <div data-raised className="absolute inset-0 rounded-md bg-surface-raised shadow-xl" />
            {/* The row's copy is written in here. Its columns answer to the width of a container, like the list's. */}
            <div ref={copyRef} className="@container relative size-full" />
            <span
              data-raised
              hidden={!isGroup}
              data-testid="drag-count"
              className="absolute -top-2 right-gutter flex h-6 min-w-6 items-center justify-center rounded-full bg-accent px-2 text-on-accent"
            >
              <Text variant="meta" color="inherit" tabular>
                {movingCount}
              </Text>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** For a row that can't be picked up, in a list where others can, so the columns still line up. */
export function DragHandleSpace() {
  return <span aria-hidden className="-ml-gutter size-tap shrink-0" />;
}

type DragHandleProps = {
  className?: string;
};

/** Where a finger picks a row up. It isn't a button: the keyboard has Move up and Move down in the menu. */
export function DragHandle({ className }: DragHandleProps) {
  return (
    <span
      data-drag-handle
      aria-hidden
      className={cn(
        '-ml-gutter flex size-tap shrink-0 cursor-grab touch-none items-center justify-center text-text-faint',
        className,
      )}
    >
      <GripVertical />
    </span>
  );
}
