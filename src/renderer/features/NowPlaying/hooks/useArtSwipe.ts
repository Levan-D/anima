import { useRef, type PointerEvent } from 'react';
import { isSideways, swipeAction } from '@/features/NowPlaying/utils/swipe';
import { playNextTrack, playPreviousTrack } from '@/lib/playerActions';
import { playerState } from '@/lib/playerStore';

/** How far the art follows the finger, as a part of how far the finger went. */
const FOLLOW = 0.25;

type Press = {
  pointerId: number;
  x: number;
  y: number;
  width: number;
};

/**
 * A finger across the art changes track, and the art leans after it on the way. A mouse never does. The element needs
 * `touch-action: pan-y`, so the browser leaves sideways moves here and a vertical one ends in a cancel.
 */
export function useArtSwipe() {
  const followRef = useRef<HTMLElement>(null);
  const press = useRef<Press | null>(null);
  const didSwipe = useRef(false);

  function lean(dx: number): void {
    const element = followRef.current;
    if (!element) return;
    // Straight onto the finger: the transition in its classes is for coming back.
    element.style.transition = dx === 0 ? '' : 'none';
    element.style.transform = dx === 0 ? '' : `translateX(${dx * FOLLOW}px)`;
  }

  function onPointerDown(event: PointerEvent<HTMLElement>): void {
    didSwipe.current = false;
    const { current, status } = playerState();
    if (event.pointerType !== 'touch' || current === null || status === 'unavailable') return;
    press.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      width: event.currentTarget.clientWidth,
    };
  }

  function onPointerMove(event: PointerEvent): void {
    const from = press.current;
    if (from === null || event.pointerId !== from.pointerId) return;
    const dx = event.clientX - from.x;
    lean(isSideways(dx, event.clientY - from.y) ? dx : 0);
  }

  function onPointerUp(event: PointerEvent): void {
    const from = press.current;
    if (from === null || event.pointerId !== from.pointerId) return;
    press.current = null;
    lean(0);
    const action = swipeAction(event.clientX - from.x, event.clientY - from.y, from.width);
    if (action === null) return;
    didSwipe.current = true;
    if (action === 'next') playNextTrack();
    else playPreviousTrack();
  }

  function onPointerCancel(): void {
    press.current = null;
    lean(0);
  }

  /** Whether the click that follows a press was really a tap. */
  function wasTap(): boolean {
    const swiped = didSwipe.current;
    didSwipe.current = false;
    return !swiped;
  }

  return { followRef, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel }, wasTap };
}
