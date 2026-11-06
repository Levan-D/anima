/*
 * The quick crossfade between pages, tabs and places in the list. It's the browser's view transition rather than two trees
 * side by side: the page being left doesn't stay mounted, and only pictures are composited, so the cost doesn't depend on
 * what's on the page.
 */
import { flushSync } from 'react-dom';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { prefersReducedMotion } from '@/lib/motionTokens';

let waiting: (() => void)[] = [];

function canFade(): boolean {
  return (
    typeof document !== 'undefined' &&
    'startViewTransition' in document &&
    // A hidden window draws no frames, so the change would wait for it to come back.
    !document.documentElement.hasAttribute('data-window-hidden') &&
    !prefersReducedMotion()
  );
}

function ignore(): void {}

function clickWhereItEnded(up: PointerEvent): void {
  document.elementFromPoint(up.clientX, up.clientY)?.dispatchEvent(
    new PointerEvent('click', {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      detail: 1,
      pointerType: up.pointerType,
      clientX: up.clientX,
      clientY: up.clientY,
      ctrlKey: up.ctrlKey,
      shiftKey: up.shiftKey,
      altKey: up.altKey,
      metaKey: up.metaKey,
    }),
  );
}

/**
 * The page can't be hit while a transition is drawn over it, whatever `pointer-events` says: a press lands on the document.
 * So anything from the pointer ends the fade, and a press is passed on as the click it would have been.
 */
function giveWayToInput(transition: ViewTransition): void {
  const end = () => transition.skipTransition();
  const onPress = ({ target, button }: PointerEvent) => {
    end();
    if (button !== 0 || (target !== document.documentElement && target !== document.body)) return;
    window.addEventListener('pointerup', clickWhereItEnded, { capture: true, once: true });
  };
  window.addEventListener('pointerdown', onPress, true);
  window.addEventListener('wheel', end, { capture: true, passive: true });
  const stop = () => {
    window.removeEventListener('pointerdown', onPress, true);
    window.removeEventListener('wheel', end, true);
  };
  transition.finished.then(stop, stop);
}

// Changes in one tick share a picture: going to another page and a place on it, say. A second transition would skip the first.
export function crossfade(change: () => void): void {
  if (!canFade()) {
    change();
    return;
  }
  waiting.push(change);
  if (waiting.length > 1) return;
  const transition = document.startViewTransition(() => {
    const changes = waiting;
    waiting = [];
    flushSync(() => {
      for (const run of changes) run();
    });
  });
  // A newer change skips this one, which rejects these. Starting from what's showing is what's wanted then.
  transition.ready.catch(ignore);
  giveWayToInput(transition);
}

/**
 * What the views subscribe to, following a store, whose own state stays up to date for whoever reads it. The picture has to
 * be taken before the views change, so the changes that `fades` picks reach them a frame later.
 */
export function crossfadedView<State>(
  store: StoreApi<State>,
  fades: (before: State, after: State) => boolean,
): UseBoundStore<StoreApi<State>> {
  const view = create<State>()(() => store.getState());
  store.subscribe((after, before) => {
    if (fades(before, after)) crossfade(() => view.setState(store.getState(), true));
    else view.setState(after, true);
  });
  return view;
}
