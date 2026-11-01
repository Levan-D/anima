import { useState, type FocusEvent, type PointerEvent, type TransitionEvent } from 'react';

export const LEAVING_ATTRIBUTE = 'data-unmounts-after-transition';

function pickSide(trigger: HTMLElement): void {
  const scroller = trigger.closest('.overflow-y-auto');
  if (scroller === null) return;
  const box = trigger.getBoundingClientRect();
  const hasRoom = box.right + box.width / 2 <= scroller.getBoundingClientRect().right;
  trigger.style.setProperty('--disc-side', hasRoom ? '1' : '-1');
}

/**
 * Something that exists only while its trigger is hovered or keyboard-focused, so a long list pays for one. CSS moves it in
 * and out. Once it's on its way out, the end of that transition takes it away. Not on touch: nothing there can hover.
 */
export function useHoverPresence() {
  const [isPresent, setPresent] = useState(false);

  return {
    isPresent,
    triggerProps: {
      onPointerEnter: (event: PointerEvent<HTMLElement>) => {
        if (event.pointerType !== 'mouse') return;
        pickSide(event.currentTarget);
        setPresent(true);
      },
      onFocus: (event: FocusEvent<HTMLElement>) => {
        if (!event.currentTarget.matches(':focus-visible')) return;
        pickSide(event.currentTarget);
        setPresent(true);
      },
      onTransitionEnd: ({ target, currentTarget }: TransitionEvent<HTMLElement>) => {
        const isOurs = target instanceof Element && target.hasAttribute(LEAVING_ATTRIBUTE);
        if (isOurs && !currentTarget.matches(':hover, :focus-visible')) setPresent(false);
      },
    },
  };
}
