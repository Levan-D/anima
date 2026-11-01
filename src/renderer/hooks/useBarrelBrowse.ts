import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type WheelEvent,
} from 'react';

// A notch is 100, and a trackpad's small deltas add up to it. The pause after a step, which drops what comes in during it,
// is what keeps one swipe and its inertia to about one card.
const WHEEL_STEP = 100;
const WHEEL_PAUSE_MS = 350;
const DRAG_THRESHOLD = 8;
/** How much of the barrel's width a drag covers for one step. */
const DRAG_STEP_SHARE = 0.1;
export const CENTER_ATTRIBUTE = 'data-barrel-center';
const CENTER = `[${CENTER_ATTRIBUTE}]`;

function canScrollInside(target: Element, root: Element): boolean {
  for (let at: Element | null = target; at !== null && at !== root; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at);
    if ((overflowY === 'auto' || overflowY === 'scroll') && at.scrollHeight > at.clientHeight) return true;
  }
  return false;
}

type Drag = { pointerId: number; startX: number; lastX: number; isTurning: boolean };

type Options = {
  keys: readonly string[];
  liveIndex: number;
  returnAfterMs: number;
};

/**
 * Turning a barrel by hand. What's browsed to is held by key, so a track change underneath moves nothing until it returns
 * to the live index, whatever that has become. Only a timer while browsing: nothing runs at rest.
 */
export function useBarrelBrowse({ keys, liveIndex, returnAfterMs }: Options) {
  const [browsedKey, setBrowsedKey] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const returnTimer = useRef<number | undefined>(undefined);
  const wheelTotal = useRef(0);
  const wheelPausedUntil = useRef(0);
  const drag = useRef<Drag | null>(null);
  const didDrag = useRef(false);
  const stepToFocus = useRef<number | null>(null);

  const browsedIndex = browsedKey === null ? -1 : keys.indexOf(browsedKey);
  const isBrowsing = browsedIndex >= 0;
  const centerIndex = isBrowsing ? browsedIndex : liveIndex;

  useEffect(() => {
    const step = stepToFocus.current;
    if (step === null) return;
    stepToFocus.current = null;
    areaRef.current?.querySelector<HTMLElement>(`[data-step="${step}"] button`)?.focus({ preventScroll: true });
  }, [centerIndex, isBrowsing]);

  useEffect(() => () => window.clearTimeout(returnTimer.current), []);

  function goLive(): void {
    window.clearTimeout(returnTimer.current);
    // The center can't hold focus at rest, so a keyboard carries on from its neighbour.
    if (areaRef.current?.contains(document.activeElement) && document.activeElement?.closest('[data-step="0"]')) {
      stepToFocus.current = 1;
    }
    setBrowsedKey(null);
    setSelectedKey(null);
  }

  function waitToReturn(): void {
    window.clearTimeout(returnTimer.current);
    returnTimer.current = window.setTimeout(goLive, returnAfterMs);
  }

  function turn(by: number): void {
    setBrowsedKey((browsed) => {
      const at = browsed === null ? -1 : keys.indexOf(browsed);
      const next = Math.min(Math.max((at < 0 ? liveIndex : at) + by, 0), keys.length - 1);
      return keys[next] ?? null;
    });
    waitToReturn();
  }

  function toggleSelected(key: string): void {
    setSelectedKey((selected) => (selected === key ? null : key));
    waitToReturn();
  }

  function onWheel(event: WheelEvent<HTMLDivElement>): void {
    if (event.ctrlKey || !(event.target instanceof Element)) return;
    if (canScrollInside(event.target, event.currentTarget)) return;
    if (event.timeStamp < wheelPausedUntil.current) return;
    const isSideways = Math.abs(event.deltaX) > Math.abs(event.deltaY);
    wheelTotal.current += isSideways ? event.deltaX : event.deltaY;
    if (Math.abs(wheelTotal.current) < WHEEL_STEP) return;
    turn(Math.sign(wheelTotal.current));
    wheelTotal.current = 0;
    wheelPausedUntil.current = event.timeStamp + WHEEL_PAUSE_MS;
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>): void {
    didDrag.current = false;
    if (event.button !== 0 || !(event.target instanceof Element) || event.target.closest(CENTER)) return;
    drag.current = { pointerId: event.pointerId, startX: event.clientX, lastX: event.clientX, isTurning: false };
    // Held still, it isn't over yet.
    window.clearTimeout(returnTimer.current);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>): void {
    const held = drag.current;
    if (held === null || held.pointerId !== event.pointerId) return;
    if (!held.isTurning) {
      if (Math.abs(event.clientX - held.startX) < DRAG_THRESHOLD) return;
      held.isTurning = true;
      didDrag.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    const stepWidth = event.currentTarget.clientWidth * DRAG_STEP_SHARE;
    const steps = Math.trunc((event.clientX - held.lastX) / stepWidth);
    if (steps === 0) return;
    held.lastX += steps * stepWidth;
    turn(-steps);
    window.clearTimeout(returnTimer.current);
  }

  function onPointerEnd(): void {
    drag.current = null;
    if (browsedKey !== null || selectedKey !== null) waitToReturn();
  }

  function onClickCapture(event: MouseEvent<HTMLDivElement>): void {
    if (!didDrag.current) return;
    didDrag.current = false;
    event.stopPropagation();
    event.preventDefault();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const by = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (by === undefined || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    if (event.target instanceof Element && event.target.closest(CENTER)) return;
    // Taken here, or the hotkeys would seek as well.
    event.preventDefault();
    stepToFocus.current = 0;
    turn(by);
  }

  function onClick(event: MouseEvent<HTMLDivElement>): void {
    if (event.target instanceof Element && !event.target.closest('button')) setSelectedKey(null);
    if (browsedKey !== null) waitToReturn();
  }

  return {
    centerIndex,
    isBrowsing,
    selectedKey,
    toggleSelected,
    goLive,
    areaRef,
    areaProps: {
      onWheel,
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
      onClickCapture,
      onClick,
      onKeyDown,
    },
  };
}
