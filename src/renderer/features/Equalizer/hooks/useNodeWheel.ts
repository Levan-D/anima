import { useEffect, useRef, type RefObject } from 'react';

/**
 * Says which band's node the wheel turned over. One listener for the plot, and by hand because React's own wheel events
 * are passive: without preventDefault the turn would also scroll the modal when that has room to.
 */
export function useNodeWheel(
  plot: RefObject<HTMLElement | null>,
  onWheel: (bandId: number, isUp: boolean) => void,
): void {
  const latest = useRef(onWheel);
  useEffect(() => {
    latest.current = onWheel;
  });

  useEffect(() => {
    const element = plot.current;
    if (element === null) return undefined;
    function listener(event: WheelEvent): void {
      const node = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-band-id]') : null;
      if (node === null) return;
      event.preventDefault();
      latest.current(Number(node.dataset.bandId), event.deltaY < 0);
    }
    element.addEventListener('wheel', listener, { passive: false });
    return () => element.removeEventListener('wheel', listener);
  }, [plot]);
}
