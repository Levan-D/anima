import { useEffect, useLayoutEffect, useRef, type DragEvent, type MouseEvent, type PointerEvent } from 'react';
import { gapAt, gapToIndex, isSamePlace, type RowBox } from '@/lib/reorder';

const MOUSE_SLOP_PX = 6;
const EDGE_ZONE = 0.15;
/** At the very edge, in scroller heights a second. */
const FASTEST_SCROLL = 1.5;

type Options = {
  /** Every row that can be reordered or dropped between, in order. */
  ids: readonly number[];
  onMove: (ids: number[], toIndex: number) => void;
  /** What goes along with this row when it's picked up, itself included. Leave out for just the row. */
  movingWith?: ((id: number) => number[]) | undefined;
};

type DragSetup = {
  container: HTMLElement;
  indicator: HTMLElement;
  pointerId: number;
  startX: number;
  startY: number;
  /** A finger on a handle means it from the first moment. A mouse could still be clicking. */
  startsAtOnce: boolean;
  moving: ReadonlySet<number>;
  idsNow: () => readonly number[];
  onActive: () => void;
  onDrop: (gap: number) => void;
  onEnd: () => void;
};

/** Follows one pointer until it lets go. Returns how to abandon it. */
function followDrag(setup: DragSetup): () => void {
  const { container, indicator, pointerId, moving } = setup;
  const scroller = container.querySelector<HTMLElement>('[data-scroller]');
  let y = setup.startY;
  let isActive = false;
  let gap: number | null = null;
  let frame = 0;
  let lastFrameAt = 0;

  function paint(): void {
    const indexes = new Map(setup.idsNow().map((id, index) => [id, index]));
    const boxes: (RowBox & { element: HTMLElement })[] = [];
    for (const element of container.querySelectorAll<HTMLElement>('[data-drag-id]')) {
      const id = Number(element.dataset.dragId);
      element.toggleAttribute('data-dragging', moving.has(id));
      const index = indexes.get(id);
      if (index === undefined) continue;
      const { top, height } = element.getBoundingClientRect();
      boxes.push({ index, top, height, element });
    }
    boxes.sort((a, b) => a.index - b.index);

    const bounds = (scroller ?? container).getBoundingClientRect();
    gap = gapAt(boxes, Math.min(Math.max(y, bounds.top), bounds.bottom));

    const below = boxes.find(({ index }) => index === gap);
    const above = boxes.find(({ index }) => index === (gap ?? 0) - 1);
    const edge = below?.top ?? (above ? above.top + above.height : null);
    indicator.hidden = edge === null || edge < bounds.top || edge > bounds.bottom;
    if (edge !== null) indicator.style.transform = `translateY(${edge - container.getBoundingClientRect().top}px)`;
  }

  function autoScroll(elapsedMs: number): void {
    if (!scroller) return;
    const { top, bottom, height } = scroller.getBoundingClientRect();
    const zone = height * EDGE_ZONE;
    const pull = Math.max((top + zone - y) / zone, 0) - Math.max((y - (bottom - zone)) / zone, 0);
    if (pull === 0) return;
    const clamped = Math.min(Math.max(pull, -1), 1);
    scroller.scrollTop -= clamped * height * FASTEST_SCROLL * (elapsedMs / 1000);
  }

  function tick(now: number): void {
    autoScroll(lastFrameAt === 0 ? 0 : now - lastFrameAt);
    lastFrameAt = now;
    paint();
    frame = requestAnimationFrame(tick);
  }

  function activate(): void {
    isActive = true;
    // On something that stays: the row under a finger can be virtualized away as the list scrolls.
    container.setPointerCapture(pointerId);
    container.toggleAttribute('data-reordering', true);
    setup.onActive();
    frame = requestAnimationFrame(tick);
  }

  function onPointerMove(event: globalThis.PointerEvent): void {
    if (event.pointerId !== pointerId) return;
    y = event.clientY;
    if (isActive) return;
    if (Math.hypot(event.clientX - setup.startX, event.clientY - setup.startY) > MOUSE_SLOP_PX) activate();
  }

  function finish(shouldDrop: boolean): void {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
    window.removeEventListener('keydown', onKeyDown, true);
    cancelAnimationFrame(frame);
    indicator.hidden = true;
    container.removeAttribute('data-reordering');
    for (const element of container.querySelectorAll('[data-dragging]')) element.removeAttribute('data-dragging');
    if (isActive && shouldDrop && gap !== null) setup.onDrop(gap);
    setup.onEnd();
  }

  function onPointerUp(event: globalThis.PointerEvent): void {
    if (event.pointerId === pointerId) finish(true);
  }

  function onPointerCancel(event: globalThis.PointerEvent): void {
    if (event.pointerId === pointerId) finish(false);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !isActive) return;
    // Or it would also go back a place.
    event.preventDefault();
    event.stopPropagation();
    finish(false);
  }

  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);
  window.addEventListener('keydown', onKeyDown, true);
  if (setup.startsAtOnce) activate();
  return () => finish(false);
}

/**
 * Reordering by drag, over a list of any length that may be virtualized. Rows say what they are with `data-drag-id`.
 * A mouse drags a row from anywhere, and a finger only from its `data-drag-handle`, because a finger on the row itself
 * is scrolling, or a long press for the menu. A list that scrolls marks its scroller with `data-scroller`.
 */
export function useDragReorder({ ids, onMove, movingWith }: Options) {
  const containerRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ ids, onMove, movingWith });
  const abandon = useRef<(() => void) | null>(null);
  const isDragging = useRef(false);
  const shouldSwallowClick = useRef(false);

  useLayoutEffect(() => {
    latest.current = { ids, onMove, movingWith };
  });

  useEffect(() => () => abandon.current?.(), []);

  function onPointerDownCapture(event: PointerEvent<HTMLDivElement>): void {
    shouldSwallowClick.current = false;
    const container = containerRef.current;
    const indicator = indicatorRef.current;
    const target = event.target as Element;
    const row = target.closest<HTMLElement>('[data-drag-id]');
    if (!container || !indicator || !row || abandon.current) return;

    const isMouse = event.pointerType === 'mouse';
    if (isMouse ? event.button !== 0 : !target.closest('[data-drag-handle]')) return;
    // Or Radix starts counting towards a long press.
    if (!isMouse) event.stopPropagation();

    const pressedId = Number(row.dataset.dragId);
    const moving = latest.current.movingWith?.(pressedId) ?? [pressedId];

    abandon.current = followDrag({
      container,
      indicator,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startsAtOnce: !isMouse,
      moving: new Set(moving),
      idsNow: () => latest.current.ids,
      onActive() {
        isDragging.current = true;
      },
      onDrop(gap) {
        const toIndex = gapToIndex(latest.current.ids, moving, gap);
        if (!isSamePlace(latest.current.ids, moving, toIndex)) latest.current.onMove(moving, toIndex);
      },
      onEnd() {
        shouldSwallowClick.current = isDragging.current;
        isDragging.current = false;
        abandon.current = null;
      },
    });
  }

  function onClickCapture(event: MouseEvent<HTMLDivElement>): void {
    const isOnHandle = (event.target as Element).closest('[data-drag-handle]') !== null;
    if (!shouldSwallowClick.current && !isOnHandle) return;
    shouldSwallowClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  /** Windows sends one for a finger held still, which is what a slow drag starts as. */
  function onContextMenuCapture(event: MouseEvent<HTMLDivElement>): void {
    if (!isDragging.current) return;
    event.preventDefault();
    event.stopPropagation();
  }

  /** Art in a row would otherwise start the browser's own drag, which ends the pointer events. */
  function onDragStartCapture(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
  }

  return {
    containerRef,
    indicatorRef,
    handlers: { onPointerDownCapture, onClickCapture, onContextMenuCapture, onDragStartCapture },
  };
}
