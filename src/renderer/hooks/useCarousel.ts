import { useCallback, useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';

// A notch of a mouse wheel is about 100. A trackpad sends many small ones, which add up to the same.
const WHEEL_NOTCH = 60;

type Edges = {
  canGoBack: boolean;
  canGoForward: boolean;
};

function slideStops(strip: HTMLElement): number[] {
  const slides = [...strip.children] as HTMLElement[];
  const origin = slides[0]?.offsetLeft ?? 0;
  const last = strip.scrollWidth - strip.clientWidth;
  return [...new Set(slides.map((slide) => Math.min(slide.offsetLeft - origin, last)))];
}

function buttonOf(slide: Element): HTMLElement | null {
  return slide instanceof HTMLButtonElement ? slide : slide.querySelector('button');
}

function behavior(): ScrollBehavior {
  return matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

/**
 * Sideways through a strip of slides, one snap at a time. A finger and a sideways wheel are the browser's. An up-and-down
 * wheel moves it too, until it reaches an end and hands the wheel back to the page, so the strip can't trap the scroll.
 * Slides with a button in them are stepped through by those, on the strip's one tab stop, as a list's rows are.
 */
export function useCarousel<Strip extends HTMLElement>() {
  const ref = useRef<Strip>(null);
  // Where a move is heading: a second one during the animation goes on from there, not from where it has got to.
  const target = useRef<number | null>(null);
  const [edges, setEdges] = useState<Edges>({ canGoBack: false, canGoForward: false });

  const goTo = useCallback((left: number) => {
    target.current = left;
    ref.current?.scrollTo({ left, behavior: behavior() });
  }, []);

  const move = useCallback(
    (slides: number) => {
      const strip = ref.current;
      if (!strip) return;
      const stops = slideStops(strip);
      const from = target.current ?? strip.scrollLeft;
      const nearest = stops.reduce(
        (best, stop, index) => (Math.abs(stop - from) < Math.abs((stops[best] ?? 0) - from) ? index : best),
        0,
      );
      const next = stops[Math.max(0, Math.min(stops.length - 1, nearest + slides))];
      if (next !== undefined) goTo(next);
    },
    [goTo],
  );

  const page = useCallback(
    (direction: 1 | -1) => {
      const strip = ref.current;
      if (!strip) return;
      const [first, second] = [...strip.children] as HTMLElement[];
      const slide = first && second ? second.offsetLeft - first.offsetLeft : strip.clientWidth;
      move(direction * Math.max(1, Math.floor(strip.clientWidth / slide)));
    },
    [move],
  );

  useEffect(() => {
    const strip = ref.current;
    if (!strip) return;

    const position = () => target.current ?? strip.scrollLeft;
    const isAtEnd = () => position() >= strip.scrollWidth - strip.clientWidth - 1;
    const isAtStart = () => position() <= 1;
    const update = () => {
      const canGoBack = strip.scrollLeft > 1;
      const canGoForward = strip.scrollLeft < strip.scrollWidth - strip.clientWidth - 1;
      setEdges((now) =>
        now.canGoBack === canGoBack && now.canGoForward === canGoForward ? now : { canGoBack, canGoForward },
      );
    };
    const onScrollEnd = () => {
      target.current = null;
      update();
    };

    let wheel = 0;
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      if (event.deltaY > 0 ? isAtEnd() : isAtStart()) return;
      event.preventDefault();
      wheel += event.deltaY;
      if (Math.abs(wheel) < WHEEL_NOTCH) return;
      move(Math.sign(wheel));
      wheel = 0;
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(strip);
    strip.addEventListener('scroll', update, { passive: true });
    strip.addEventListener('scrollend', onScrollEnd);
    strip.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      observer.disconnect();
      strip.removeEventListener('scroll', update);
      strip.removeEventListener('scrollend', onScrollEnd);
      strip.removeEventListener('wheel', onWheel);
    };
  }, [move]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<Strip>) => {
      const strip = ref.current;
      if (!strip || event.altKey || event.ctrlKey || event.metaKey) return;
      const slides = [...strip.children];
      const at = slides.findIndex((slide) => slide.contains(event.target as Node));
      if (at !== -1) {
        const steps: Record<string, number> = {
          ArrowRight: at + 1,
          ArrowLeft: at - 1,
          Home: 0,
          End: slides.length - 1,
        };
        const step = steps[event.key];
        if (step === undefined) return;
        event.preventDefault();
        const slide = slides[Math.max(0, Math.min(slides.length - 1, step))];
        if (slide) buttonOf(slide)?.focus({ preventScroll: true });
        slide?.scrollIntoView({ behavior: behavior(), block: 'nearest', inline: 'nearest' });
        return;
      }
      if (event.key === 'ArrowRight') move(1);
      else if (event.key === 'ArrowLeft') move(-1);
      else if (event.key === 'Home') goTo(0);
      else if (event.key === 'End') goTo(strip.scrollWidth - strip.clientWidth);
      else return;
      event.preventDefault();
    },
    [goTo, move],
  );

  const onFocus = useCallback((event: FocusEvent<Strip>) => {
    const strip = event.currentTarget;
    if (event.target !== strip) {
      // While a slide has focus, Shift+Tab has to leave the strip instead of landing on its tab stop.
      strip.tabIndex = -1;
      return;
    }
    const slides = [...strip.children] as HTMLElement[];
    const origin = slides[0]?.offsetLeft ?? 0;
    const inView = slides.find((slide) => slide.offsetLeft - origin >= strip.scrollLeft - 1);
    if (inView) buttonOf(inView)?.focus({ preventScroll: true });
  }, []);

  const onBlur = useCallback((event: FocusEvent<Strip>) => {
    const strip = event.currentTarget;
    if (!strip.contains(event.relatedTarget)) strip.tabIndex = 0;
  }, []);

  return { ref, ...edges, page, onKeyDown, onFocus, onBlur };
}
