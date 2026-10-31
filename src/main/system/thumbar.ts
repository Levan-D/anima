import { join } from 'node:path';
import { nativeImage, type BrowserWindow } from 'electron';
import type { PlayerState } from '@shared/domain';
import { log } from '@main/system/logging';

type Actions = {
  previous: () => void;
  toggle: () => void;
  next: () => void;
};

// No flag at all for enabled: Electron 45 documents an 'enabled' flag, and setThumbarButtons fails whenever one is passed.
const enabledIf = (isEnabled: boolean) => (isEnabled ? [] : ['disabled']);

/** The same rules as the transport's buttons. */
function look({ status, current, queueLength }: PlayerState) {
  const isUsable = status !== 'unavailable';
  return {
    isOn: status === 'playing' || status === 'loading',
    hasQueue: queueLength > 0 && isUsable,
    hasCurrent: current !== null && isUsable,
  };
}

/** Previous, play or pause, and next, on the taskbar button of whichever window has one right now. */
export function createThumbar(iconsDir: string, actions: Actions) {
  const icon = (name: string) => nativeImage.createFromPath(join(iconsDir, `${name}.png`));
  const icons = { previous: icon('previous'), play: icon('play'), pause: icon('pause'), next: icon('next') };

  let target: BrowserWindow | null = null;
  let current: ReturnType<typeof look> | null = null;
  let applied: string | null = null;

  function apply(): void {
    if (target === null || target.isDestroyed() || current === null) return;
    const key = JSON.stringify(current);
    if (key === applied) return;

    const { isOn, hasQueue, hasCurrent } = current;
    const isSet = target.setThumbarButtons([
      {
        tooltip: 'Previous',
        icon: icons.previous,
        flags: enabledIf(hasCurrent),
        click: actions.previous,
      },
      {
        tooltip: isOn ? 'Pause' : 'Play',
        icon: isOn ? icons.pause : icons.play,
        flags: enabledIf(hasQueue),
        click: actions.toggle,
      },
      {
        tooltip: 'Next',
        icon: icons.next,
        flags: enabledIf(hasCurrent),
        click: actions.next,
      },
    ]);
    if (isSet) applied = key;
    else log.warn('Windows refused the thumbnail buttons');
  }

  return {
    /** Call it each time the window is shown: hiding one takes away its taskbar button, and the buttons on it. */
    showOn: (win: BrowserWindow): void => {
      target = win;
      applied = null;
      apply();
    },
    update: (state: PlayerState): void => {
      current = look(state);
      apply();
    },
  };
}
