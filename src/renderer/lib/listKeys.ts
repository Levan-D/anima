import type { ListCell } from '@/lib/listMemory';

type Grid = {
  count: number;
  /** How many things in that item take focus. 0 for a heading, more than 1 across a row of cards. */
  columnsAt: (index: number) => number;
  /** How many items fit in the window, for Page Up and Page Down. */
  pageSize: number;
};

function nearest(from: number, step: 1 | -1, { count, columnsAt }: Grid): number | null {
  for (let index = from; index >= 0 && index < count; index += step) {
    if (columnsAt(index) > 0) return index;
  }
  return null;
}

function at(index: number | null, column: number, grid: Grid): ListCell | null {
  if (index === null) return null;
  return { index, column: Math.min(column, Math.max(grid.columnsAt(index) - 1, 0)) };
}

/** Where a key takes focus from a cell. Null when it doesn't move, so the key can do what it would have done. */
export function nextCell(key: string, { index, column }: ListCell, grid: Grid): ListCell | null {
  const { count, pageSize } = grid;

  switch (key) {
    case 'ArrowDown':
      return at(nearest(index + 1, 1, grid), column, grid);
    case 'ArrowUp':
      return at(nearest(index - 1, -1, grid), column, grid);
    case 'ArrowRight':
      if (column + 1 < grid.columnsAt(index)) return { index, column: column + 1 };
      return grid.columnsAt(index) > 1 ? at(nearest(index + 1, 1, grid), 0, grid) : null;
    case 'ArrowLeft':
      if (column > 0) return { index, column: column - 1 };
      if (grid.columnsAt(index) <= 1) return null;
      return at(nearest(index - 1, -1, grid), Number.MAX_SAFE_INTEGER, grid);
    case 'PageDown':
      return at(nearest(Math.min(index + pageSize, count - 1), 1, grid) ?? nearest(count - 1, -1, grid), column, grid);
    case 'PageUp':
      return at(nearest(Math.max(index - pageSize, 0), -1, grid) ?? nearest(0, 1, grid), column, grid);
    case 'Home':
      return at(nearest(0, 1, grid), 0, grid);
    case 'End':
      return at(nearest(count - 1, -1, grid), Number.MAX_SAFE_INTEGER, grid);
    default:
      return null;
  }
}
