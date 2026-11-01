import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import { edgePull, isSamePlace, placesOf, restingPlace, slotAt, type RowPlace } from '@/lib/reorder';

const MOUSE_SLOP_PX = 6;
const EDGE_ZONE = 0.15;
/** At the very edge, in scroller heights a second. */
const FASTEST_SCROLL = 3;
const LONGEST_SCROLL_STEP_MS = 50;
const LIFT_SCALE = 1.01;
/** How long a dropped row holds its place waiting for the new order. Past this the move failed, and that was told. */
const LANDING_HOLD_MS = 2000;

type Options = {
  /** Every row that can be reordered or dropped between, in order. */
  ids: readonly number[];
  onMove: (ids: number[], toIndex: number) => void;
  /** What goes along with this row when it's picked up, itself included. Leave out for just the row. */
  movingWith?: ((id: number) => number[]) | undefined;
};

type DragViews = {
  container: HTMLElement;
  overlay: HTMLElement;
  lifted: HTMLElement;
  copy: HTMLElement;
};

type DragSetup = DragViews & {
  row: HTMLElement;
  pressedId: number;
  moving: number[];
  pointerId: number;
  startX: number;
  startY: number;
  /** A finger on a handle means it from the first moment. A mouse could still be clicking. */
  startsAtOnce: boolean;
  idsNow: () => readonly number[];
  onActive: () => void;
  onRelease: () => void;
  onDrop: (toIndex: number) => void;
  onEnd: () => void;
};

type DragSession = {
  /** Still under the pointer, as opposed to gliding into place. */
  isFollowing: () => boolean;
  idsChanged: () => void;
  abandon: () => void;
};

function glideTiming(): KeyframeAnimationOptions {
  const root = getComputedStyle(document.documentElement);
  return {
    duration: Number.parseFloat(root.getPropertyValue('--dur-mid')),
    easing: root.getPropertyValue('--ease-standard').trim(),
  };
}

function translateY(px: number): string {
  return `translateY(${px}px)`;
}

function rowsIn(container: HTMLElement): NodeListOf<HTMLElement> {
  return container.querySelectorAll<HTMLElement>('[data-drag-id]');
}

function copyOfRow(row: HTMLElement): Node {
  const copy = row.cloneNode(true) as HTMLElement;
  for (const name of ['data-drag-id', 'data-testid', 'tabindex', 'title']) copy.removeAttribute(name);
  return copy;
}

/** Follows one pointer until it lets go, then sees the row into place. */
function followDrag(setup: DragSetup): DragSession {
  const { container, overlay, lifted, copy, row, pressedId, moving, pointerId } = setup;
  const scroller = container.querySelector<HTMLElement>('[data-scroller]');
  const movingSet = new Set(moving);

  let phase: 'pressed' | 'following' | 'landing' | 'returning' = 'pressed';
  let y = setup.startY;
  let places: ReadonlyMap<number, RowPlace> = new Map();
  let restCount = 0;
  let rowHeight = 0;
  let grabOffset = 0;
  /** Where the first row starts, in the scroller's content. */
  let listTop = 0;
  let containerTop = 0;
  let bounds = new DOMRect();
  let timing: KeyframeAnimationOptions = {};
  let slot = 0;
  let overlayTop = 0;
  let written = new WeakMap<HTMLElement, number>();
  let isFirstPaint = true;
  let hasArrived = false;
  let isGlideDone = false;
  let frame = 0;
  let lastFrameAt = 0;
  let scrollCarry = 0;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;

  function readPlaces(): void {
    const ids = setup.idsNow();
    places = placesOf(ids, movingSet);
    restCount = ids.reduce((count, id) => (movingSet.has(id) ? count : count + 1), 0);
  }

  function shiftOf(id: number): number {
    if (hasArrived || phase === 'returning' || movingSet.has(id)) return 0;
    const place = places.get(id);
    if (place === undefined) return 0;
    return (restingPlace(place.rank, slot, moving.length) - place.index) * rowHeight;
  }

  // A row the virtualizer has just added gets its place without a transition, and may slide from the next frame on.
  function paintRows(): void {
    for (const element of rowsIn(container)) {
      const id = Number(element.dataset.dragId);
      const shift = shiftOf(id);
      const last = written.get(element);
      if (last === undefined) element.toggleAttribute('data-dragging', movingSet.has(id));
      if ((last !== undefined || isFirstPaint) && !element.hasAttribute('data-sliding')) {
        element.toggleAttribute('data-sliding', true);
      }
      if (last !== shift) {
        element.style.transform = shift === 0 ? '' : translateY(shift);
        written.set(element, shift);
      }
    }
    isFirstPaint = false;
  }

  function clearRows(): void {
    for (const element of rowsIn(container)) {
      element.removeAttribute('data-dragging');
      element.removeAttribute('data-sliding');
      element.style.transform = '';
    }
    written = new WeakMap();
  }

  function scrollTop(): number {
    return scroller?.scrollTop ?? 0;
  }

  function autoScroll(elapsedMs: number): void {
    if (!scroller) return;
    const pull = edgePull(y, bounds.top, bounds.bottom, bounds.height * EDGE_ZONE);
    if (pull === 0) {
      scrollCarry = 0;
      return;
    }
    // Carried over, because at low speed a frame's worth is under a pixel, and scrollTop would round it away.
    scrollCarry += pull * bounds.height * FASTEST_SCROLL * (elapsedMs / 1000);
    const whole = Math.trunc(scrollCarry);
    if (whole === 0) return;
    scroller.scrollTop += whole;
    scrollCarry -= whole;
  }

  function placeOverlay(): void {
    const top = Math.max(Math.min(y - grabOffset, bounds.bottom - rowHeight), bounds.top);
    slot = slotAt(top + scrollTop() - listTop, rowHeight, restCount);
    if (top === overlayTop) return;
    overlayTop = top;
    overlay.style.transform = translateY(top - containerTop);
  }

  function tick(now: number): void {
    if (phase === 'following') {
      autoScroll(lastFrameAt === 0 ? 0 : Math.min(now - lastFrameAt, LONGEST_SCROLL_STEP_MS));
      lastFrameAt = now;
      placeOverlay();
    }
    paintRows();
    frame = requestAnimationFrame(tick);
  }

  function raisedParts(): NodeListOf<HTMLElement> {
    return overlay.querySelectorAll<HTMLElement>('[data-raised]');
  }

  function lift(): void {
    lifted.style.scale = String(LIFT_SCALE);
    lifted.animate([{ scale: '1' }, { scale: String(LIFT_SCALE) }], timing);
    for (const part of raisedParts()) part.animate([{ opacity: 0 }, { opacity: 1 }], timing);
  }

  function glideTo(index: number): void {
    const from = translateY(overlayTop - containerTop);
    const to = translateY(listTop + index * rowHeight - scrollTop() - containerTop);
    overlay.style.transform = to;
    lifted.style.scale = '';
    lifted.animate([{ scale: String(LIFT_SCALE) }, { scale: '1' }], timing);
    for (const part of raisedParts()) part.animate([{ opacity: 1 }, { opacity: 0 }], { ...timing, fill: 'forwards' });
    overlay.animate([{ transform: from }, { transform: to }], timing).onfinish = () => {
      isGlideDone = true;
      endIfSettled();
    };
  }

  function endIfSettled(): void {
    if (isGlideDone && (phase === 'returning' || hasArrived)) end();
  }

  function end(): void {
    cancelAnimationFrame(frame);
    clearTimeout(holdTimer);
    for (const animation of overlay.getAnimations({ subtree: true })) animation.cancel();
    lifted.style.scale = '';
    overlay.hidden = true;
    copy.replaceChildren();
    clearRows();
    setup.onEnd();
  }

  function activate(): void {
    phase = 'following';
    const box = row.getBoundingClientRect();
    bounds = (scroller ?? container).getBoundingClientRect();
    containerTop = container.getBoundingClientRect().top;
    readPlaces();
    rowHeight = box.height;
    grabOffset = setup.startY - box.top;
    listTop = box.top + scrollTop() - (places.get(pressedId)?.index ?? 0) * rowHeight;
    timing = glideTiming();

    overlay.style.left = `${box.left - container.getBoundingClientRect().left}px`;
    overlay.style.width = `${box.width}px`;
    overlay.style.height = `${box.height}px`;
    overlayTop = box.top;
    overlay.style.transform = translateY(box.top - containerTop);
    copy.replaceChildren(copyOfRow(row));
    overlay.hidden = false;

    // On something that stays: the row under a finger can be virtualized away as the list scrolls.
    container.setPointerCapture(pointerId);
    container.toggleAttribute('data-reordering', true);
    setup.onActive();
    lift();
    placeOverlay();
    paintRows();
    frame = requestAnimationFrame(tick);
  }

  function stopListening(): void {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
    window.removeEventListener('keydown', onKeyDown, true);
    container.removeAttribute('data-reordering');
  }

  function release(shouldDrop: boolean): void {
    stopListening();
    setup.onRelease();
    if (phase === 'pressed') {
      setup.onEnd();
      return;
    }

    const ids = setup.idsNow();
    if (shouldDrop && !isSamePlace(ids, moving, slot)) {
      phase = 'landing';
      holdTimer = setTimeout(end, LANDING_HOLD_MS);
      glideTo(slot + moving.indexOf(pressedId));
      setup.onDrop(slot);
      return;
    }
    phase = 'returning';
    glideTo(places.get(pressedId)?.index ?? 0);
  }

  function onPointerMove(event: globalThis.PointerEvent): void {
    if (event.pointerId !== pointerId) return;
    y = event.clientY;
    if (phase !== 'pressed') return;
    if (Math.hypot(event.clientX - setup.startX, event.clientY - setup.startY) > MOUSE_SLOP_PX) activate();
  }

  function onPointerUp(event: globalThis.PointerEvent): void {
    if (event.pointerId === pointerId) release(true);
  }

  function onPointerCancel(event: globalThis.PointerEvent): void {
    if (event.pointerId === pointerId) release(false);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || phase !== 'following') return;
    // Or it would also go back a place.
    event.preventDefault();
    event.stopPropagation();
    release(false);
  }

  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);
  window.addEventListener('keydown', onKeyDown, true);
  if (setup.startsAtOnce) activate();

  return {
    isFollowing: () => phase === 'pressed' || phase === 'following',
    idsChanged() {
      if (phase === 'following') readPlaces();
      if (phase !== 'landing' || hasArrived || !isSamePlace(setup.idsNow(), moving, slot)) return;
      // In the commit that brought the new order, so no frame shows the rows shifted twice.
      hasArrived = true;
      clearRows();
      paintRows();
      endIfSettled();
    },
    abandon() {
      stopListening();
      end();
    },
  };
}

/** Move up and Move down swap neighbours: anything bigger isn't a nudge, and is better arriving at once. */
function glideNudgedRows(container: HTMLElement, before: readonly number[], after: readonly number[]): void {
  if (before.length !== after.length) return;
  const wasAt = new Map(before.map((id, index) => [id, index]));
  const isAt = new Map(after.map((id, index) => [id, index]));
  const nudged: { element: HTMLElement; by: number }[] = [];
  for (const element of rowsIn(container)) {
    const id = Number(element.dataset.dragId);
    const was = wasAt.get(id);
    const is = isAt.get(id);
    if (was === undefined || is === undefined || Math.abs(was - is) > 1) return;
    if (was !== is) nudged.push({ element, by: was - is });
  }
  if (nudged.length === 0) return;
  const timing = glideTiming();
  for (const { element, by } of nudged) {
    element.animate([{ transform: translateY(by * element.offsetHeight) }, { transform: 'none' }], timing);
  }
}

/**
 * Reordering by drag, over a list of any length that may be virtualized, whose rows are all one height. Rows say what
 * they are with `data-drag-id`. A mouse drags a row from anywhere, and a finger only from its `data-drag-handle`, because
 * a finger on the row itself is scrolling, or a long press for the menu. A list that scrolls marks its scroller with
 * `data-scroller`. Nothing here renders the rows: their positions are written to them each frame.
 */
export function useDragReorder({ ids, onMove, movingWith }: Options) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const liftedRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ ids, onMove, movingWith });
  const previousIds = useRef(ids);
  const session = useRef<DragSession | null>(null);
  const isDragging = useRef(false);
  const shouldSwallowClick = useRef(false);
  const [movingCount, setMovingCount] = useState(0);

  useLayoutEffect(() => {
    latest.current = { ids, onMove, movingWith };
  });

  useLayoutEffect(() => {
    const before = previousIds.current;
    previousIds.current = ids;
    if (before === ids) return;
    if (session.current) session.current.idsChanged();
    else if (containerRef.current) glideNudgedRows(containerRef.current, before, ids);
  }, [ids]);

  useEffect(() => () => session.current?.abandon(), []);

  function onPointerDownCapture(event: PointerEvent<HTMLDivElement>): void {
    shouldSwallowClick.current = false;
    const container = containerRef.current;
    const overlay = overlayRef.current;
    const lifted = liftedRef.current;
    const copy = copyRef.current;
    const target = event.target as Element;
    const row = target.closest<HTMLElement>('[data-drag-id]');
    if (!container || !overlay || !lifted || !copy || !row || session.current?.isFollowing()) return;

    const isMouse = event.pointerType === 'mouse';
    if (isMouse ? event.button !== 0 : !target.closest('[data-drag-handle]')) return;
    // Or Radix starts counting towards a long press.
    if (!isMouse) event.stopPropagation();
    session.current?.abandon();

    const pressedId = Number(row.dataset.dragId);
    const moving = latest.current.movingWith?.(pressedId) ?? [pressedId];

    session.current = followDrag({
      container,
      overlay,
      lifted,
      copy,
      row,
      pressedId,
      moving,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startsAtOnce: !isMouse,
      idsNow: () => latest.current.ids,
      onActive() {
        isDragging.current = true;
        setMovingCount(moving.length);
      },
      onRelease() {
        shouldSwallowClick.current = isDragging.current;
        isDragging.current = false;
      },
      onDrop(toIndex) {
        latest.current.onMove(moving, toIndex);
      },
      onEnd() {
        session.current = null;
        setMovingCount(0);
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
    overlayRef,
    liftedRef,
    copyRef,
    movingCount,
    handlers: { onPointerDownCapture, onClickCapture, onContextMenuCapture, onDragStartCapture },
  };
}
