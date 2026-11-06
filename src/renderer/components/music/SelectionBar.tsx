import { Button } from '@/components/ui/Button';
import { Fade } from '@/components/ui/Fade';
import { Text } from '@/components/ui/Text';
import { focusCurrentList } from '@/lib/listDom';
import { clearSelection, isSelectionShowing, selectAllRows, useSelection } from '@/lib/selection';

type Props = {
  /** How many rows the list has that can be picked. */
  total: number;
};

/** The way out of a selection, floating over the end of the list, so a row picked with the mouse doesn't move. */
export function SelectionBar({ total }: Props) {
  const isShowing = useSelection(isSelectionShowing);
  const count = useSelection((state) => state.keys.size);

  return (
    <Fade show={isShowing} rises className="absolute inset-x-gutter bottom-list-fade z-10">
      <div
        data-testid="selection-bar"
        className="flex min-h-row items-center gap-1 rounded-lg bg-surface-raised pr-1 pl-gutter shadow-xl"
      >
        <Text role="status" variant="meta" tabular truncate className="min-w-0 flex-1">
          {count} selected
        </Text>
        {count < total ? (
          <Button variant="ghost" size="compact" onClick={selectAllRows}>
            Select all
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="compact"
          onClick={(event) => {
            clearSelection();
            // A key press leaves focus on a button that just went away. A mouse has no focus to lose.
            if (event.detail === 0) focusCurrentList();
          }}
        >
          Done
        </Button>
      </div>
    </Fade>
  );
}
