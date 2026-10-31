import { useEffect, useMemo, type RefObject } from 'react';
import { glideAt, lineAt, type Glide, type LyricRow } from '@/features/Lyrics/utils/timeline';
import { motionDuration } from '@/lib/motionTokens';
import { PAINT_EVERY_MS, paintNow, usePlayerPosition, type PositionPainter } from '@/lib/playerPosition';
import { playerState } from '@/lib/playerStore';

/** How long after the last touch of the lyrics the text goes back to the live line. */
const FREE_FOR_MS = 3_000;
/** The clock moved by more than time did: a seek or a nudge rather than a report that differs a little. */
const JUMP_MS = 250;
/** Each move starts just before the last one lands, or the text would stop for a frame at every line. */
const RETARGET_EARLY_MS = 50;
const DRAG_STARTS_AT = 5;
const ARROW_SHARE = 0.15;
const PAGE_SHARE = 0.85;

type Elements = {
  scroller: RefObject<HTMLElement | null>;
  /** The lines, inside `scroller`, which moves them on the compositor while nobody is scrolling. */
  track: RefObject<HTMLElement | null>;
  /** Has the keyboard focus while the lyrics are open. */
  panel: RefObject<HTMLElement | null>;
};

/**
 * Following, `scroller` stays at the top and a transform on `track` does the moving: a linear transition to the next
 * line, as long as there is until that line, so nothing here runs per frame. A hand on the lyrics turns the same offset
 * into a real scroll position until they've been left alone, and it's turned back on the way to the live line.
 */
function createFollower(rows: LyricRow[], { scroller: scrollerRef, track: trackRef, panel: panelRef }: Elements) {
  let isFree = false;
  let isHeld = false;
  let isBackDue = false;
  let backTimer: ReturnType<typeof setTimeout> | null = null;
  let needsSettling = false;
  let settledAt = 0;
  let segment: string | null = null;
  let lastTime: number | null = null;
  let lastAt = 0;
  let wasPlaying = false;
  let shownLit: number | null = null;

  function positionOf(scroller: HTMLElement, track: HTMLElement, index: number): number {
    const row = track.querySelector<HTMLElement>(`[data-line="${index}"]`);
    if (row === null) return 0;
    return track.offsetTop + row.offsetTop + row.offsetHeight / 2 - scroller.clientHeight / 2;
  }

  function place(track: HTMLElement, y: number, transition: string): void {
    track.style.transition = transition;
    track.style.transform = `translateY(${-y}px)`;
  }

  /** Where it is right now, partway through any transition. */
  function shownY(track: HTMLElement): number {
    return -new DOMMatrixReadOnly(getComputedStyle(track).transform).m42;
  }

  function jumpTo(track: HTMLElement, y: number): void {
    place(track, y, 'none');
    // Flushed, or the transition that follows would start from where it was before this.
    void getComputedStyle(track).transform;
  }

  function yOf(scroller: HTMLElement, track: HTMLElement, { fromIndex, toIndex, progress }: Glide): number {
    const from = positionOf(scroller, track, fromIndex);
    return from + (positionOf(scroller, track, toIndex) - from) * progress;
  }

  function settle(
    scroller: HTMLElement,
    track: HTMLElement,
    time: number,
    isPlaying: boolean,
    token: '--dur-mid' | '--dur-slow',
  ) {
    const durationMs = motionDuration(token) * 1000;
    const y = yOf(scroller, track, glideAt(rows, isPlaying ? time + durationMs : time));
    place(track, y, durationMs === 0 ? 'none' : `transform ${durationMs}ms var(--ease-standard)`);
    settledAt = performance.now() + durationMs;
    segment = null;
    needsSettling = false;
  }

  /** Returns how long until the next line's move wants starting. */
  function glide(scroller: HTMLElement, track: HTMLElement, time: number): number {
    const next = glideAt(rows, time + RETARGET_EARLY_MS);
    const key = `${next.fromIndex}>${next.toIndex}`;
    if (key !== segment) {
      segment = key;
      if (motionDuration('--dur-mid') === 0) {
        place(track, positionOf(scroller, track, next.fromIndex), 'none');
      } else if (next.toIndex !== next.fromIndex) {
        const durationMs = next.changesInMs + RETARGET_EARLY_MS;
        place(track, positionOf(scroller, track, next.toIndex), `transform ${durationMs}ms linear`);
      }
    }
    return next.changesInMs;
  }

  function freeze(track: HTMLElement): void {
    place(track, shownY(track), 'none');
    segment = null;
  }

  function showLit(track: HTMLElement, lit: number | null): void {
    if (lit === shownLit && (lit !== null || track.querySelector('[aria-current]') === null)) return;
    track.querySelector('[aria-current]')?.removeAttribute('aria-current');
    if (lit !== null) track.querySelector(`[data-line="${lit}"]`)?.setAttribute('aria-current', 'true');
    shownLit = lit;
  }

  function stopTimer(): void {
    if (backTimer !== null) clearTimeout(backTimer);
    backTimer = null;
  }

  function startTimer(): void {
    stopTimer();
    isBackDue = false;
    if (isHeld) return;
    backTimer = setTimeout(() => {
      isBackDue = true;
      paintNow();
    }, FREE_FOR_MS);
  }

  function letGo(): void {
    const scroller = scrollerRef.current;
    const track = trackRef.current;
    if (scroller === null || track === null) return;
    if (!isFree) {
      const y = shownY(track);
      track.style.transition = 'none';
      track.style.transform = 'none';
      scroller.scrollTop = y;
      isFree = true;
      segment = null;
    }
    startTimer();
  }

  /** Same place on screen, ready to move again. */
  function takeBack(scroller: HTMLElement, track: HTMLElement): void {
    const y = scroller.scrollTop;
    scroller.scrollTop = 0;
    jumpTo(track, y);
    isFree = false;
    isBackDue = false;
    stopTimer();
  }

  const paint = (time: number): number => {
    const scroller = scrollerRef.current;
    const track = trackRef.current;
    if (scroller === null || track === null) return Infinity;
    const now = performance.now();
    const isPlaying = playerState().status === 'playing';
    const { index, isLit, changesInMs } = lineAt(rows, time);
    showLit(track, isLit ? index : null);

    const expected = lastTime === null ? time : lastTime + (wasPlaying ? now - lastAt : 0);
    const isJump = Math.abs(time - expected) > JUMP_MS;
    const isFirst = lastTime === null;
    const wasPlayingBefore = wasPlaying;
    lastTime = time;
    lastAt = now;
    wasPlaying = isPlaying;

    let wait = changesInMs;
    if (isFree && isBackDue && isPlaying) {
      takeBack(scroller, track);
      settle(scroller, track, time, isPlaying, '--dur-slow');
    }
    if (!isFree) {
      if (isFirst) {
        scroller.scrollTop = 0;
        jumpTo(track, yOf(scroller, track, glideAt(rows, time)));
      } else if (isJump || needsSettling) {
        settle(scroller, track, time, isPlaying, '--dur-mid');
      } else if (wasPlayingBefore && !isPlaying) {
        freeze(track);
      }
      if (isPlaying) {
        const untilSettled = settledAt - now;
        wait = Math.min(wait, untilSettled > 0 ? untilSettled : glide(scroller, track, time));
      }
    }
    return Math.max(wait, PAINT_EVERY_MS);
  };

  function scrollByKey(event: KeyboardEvent, scroller: HTMLElement): void {
    const { clientHeight, scrollHeight } = scroller;
    const moves: Record<string, () => void> = {
      ArrowUp: () => scroller.scrollBy({ top: -clientHeight * ARROW_SHARE }),
      ArrowDown: () => scroller.scrollBy({ top: clientHeight * ARROW_SHARE }),
      PageUp: () => scroller.scrollBy({ top: -clientHeight * PAGE_SHARE }),
      PageDown: () => scroller.scrollBy({ top: clientHeight * PAGE_SHARE }),
      Home: () => scroller.scrollTo({ top: 0 }),
      End: () => scroller.scrollTo({ top: scrollHeight }),
    };
    const move = moves[event.key];
    if (move === undefined || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    letGo();
    move();
  }

  /** Touch scrolls by itself. A mouse has to be told, and the click that ends its drag isn't a tap on a line. */
  function followMouseDrags(scroller: HTMLElement, signal: AbortSignal): void {
    let pressedAt: number | null = null;
    let startTop = 0;
    let wasDragged = false;

    scroller.addEventListener(
      'pointerdown',
      (event) => {
        if (event.pointerType !== 'mouse' || event.button !== 0) return;
        pressedAt = event.clientY;
        wasDragged = false;
      },
      { signal },
    );
    scroller.addEventListener(
      'pointermove',
      (event) => {
        if (pressedAt === null) return;
        if (!wasDragged) {
          if (Math.abs(event.clientY - pressedAt) < DRAG_STARTS_AT) return;
          wasDragged = true;
          isHeld = true;
          letGo();
          startTop = scroller.scrollTop;
          pressedAt = event.clientY;
          scroller.setPointerCapture(event.pointerId);
        }
        scroller.scrollTop = startTop - (event.clientY - pressedAt);
      },
      { signal },
    );
    const release = () => {
      pressedAt = null;
      if (!wasDragged) return;
      isHeld = false;
      startTimer();
    };
    scroller.addEventListener('pointerup', release, { signal });
    scroller.addEventListener('pointercancel', release, { signal });
    scroller.addEventListener(
      'click',
      (event) => {
        if (!wasDragged) return;
        wasDragged = false;
        event.stopPropagation();
        event.preventDefault();
      },
      { capture: true, signal },
    );
  }

  /** Returns how to stop listening. */
  function listen(): () => void {
    const scroller = scrollerRef.current;
    const panel = panelRef.current;
    if (scroller === null) return () => {};
    const stop = new AbortController();
    const { signal } = stop;
    const passive = { passive: true, signal };

    scroller.addEventListener(
      'wheel',
      (event) => {
        // Setting the scroll position cancels the scroll this tick would start, so the first one is done by hand.
        if (!isFree) {
          event.preventDefault();
          letGo();
          scroller.scrollBy({ top: event.deltaY, behavior: 'smooth' });
        }
        startTimer();
      },
      { passive: false, signal },
    );
    scroller.addEventListener(
      'touchstart',
      () => {
        isHeld = true;
        letGo();
      },
      passive,
    );
    const lift = () => {
      isHeld = false;
      if (isFree) startTimer();
    };
    scroller.addEventListener('touchend', lift, passive);
    scroller.addEventListener('touchcancel', lift, passive);
    // A flick keeps going after the finger's gone.
    scroller.addEventListener(
      'scroll',
      () => {
        if (isFree) startTimer();
      },
      passive,
    );
    followMouseDrags(scroller, signal);
    panel?.addEventListener('keydown', (event) => scrollByKey(event, scroller), { signal });

    let { clientWidth, clientHeight } = scroller;
    const resized = new ResizeObserver(() => {
      if (scroller.clientWidth === clientWidth && scroller.clientHeight === clientHeight) return;
      ({ clientWidth, clientHeight } = scroller);
      needsSettling = true;
      paintNow();
    });
    resized.observe(scroller);

    return () => {
      stop.abort();
      resized.disconnect();
      stopTimer();
    };
  }

  /** For a tap on a line: that's a request for the live line, whatever the hand was doing. */
  function backToLine(): void {
    const scroller = scrollerRef.current;
    const track = trackRef.current;
    if (scroller === null || track === null) return;
    if (isFree) takeBack(scroller, track);
    needsSettling = true;
  }

  return { paint, listen, backToLine };
}

/** Writes straight to the DOM, so the lines don't re-render with the music. Returns what a tap on a line should call. */
export function useFollowLine(rows: LyricRow[], offsetMs: number, elements: Elements): () => void {
  const { scroller, track, panel } = elements;
  const follower = useMemo(() => createFollower(rows, { scroller, track, panel }), [rows, scroller, track, panel]);
  const painter = useMemo<PositionPainter>(
    () => (positionMs) => follower.paint(positionMs - offsetMs),
    [follower, offsetMs],
  );
  usePlayerPosition(painter);
  useEffect(() => follower.listen(), [follower]);
  return follower.backToLine;
}
