import { useEffect, useMemo, useState } from 'react';
import { MINI_WINDOW_ACTIONS, mainWindowActions } from '@/features/Hotkeys/utils/hotkeyActions';
import { focusKindOf, hotkeyFor } from '@/features/Hotkeys/utils/keyMap';

/** Which window these are for, and whether its help dialog is open. */
export function useHotkeys(windowKind: 'main' | 'mini') {
  const [isHelpOpen, setHelpOpen] = useState(false);
  const actions = useMemo(
    () => (windowKind === 'mini' ? MINI_WINDOW_ACTIONS : mainWindowActions(() => setHelpOpen(true))),
    [windowKind],
  );

  useEffect(() => {
    // On the way back up from the page, so a control that used the key has said so: lists, sliders and tabs all prevent it.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const action = hotkeyFor(
        {
          key: event.key,
          code: event.code,
          ctrl: event.ctrlKey,
          shift: event.shiftKey,
          alt: event.altKey,
          meta: event.metaKey,
          repeat: event.repeat,
        },
        focusKindOf(event.target),
      );
      const run = action === null ? undefined : actions[action];
      if (!run) return;
      event.preventDefault();
      run();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [actions]);

  return { isHelpOpen, setHelpOpen };
}
