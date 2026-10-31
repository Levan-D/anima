export type HotkeyAction =
  | 'togglePlaying'
  | 'seekBack'
  | 'seekForward'
  | 'seekBackFar'
  | 'seekForwardFar'
  | 'previous'
  | 'next'
  | 'volumeUp'
  | 'volumeDown'
  | 'toggleMute'
  | 'search'
  | 'back'
  | 'settings'
  | 'fullscreen'
  | 'miniPlayer'
  | 'queue'
  | 'exclusive'
  | 'lyrics'
  | 'equalizer'
  | 'radio'
  | 'sizeUp'
  | 'sizeDown'
  | 'sizeReset'
  | 'help';

export type KeyPress = {
  key: string;
  code: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  repeat: boolean;
};

/**
 * What has focus, as far as a key is concerned.
 * - `text`: takes anything that types or moves a caret.
 * - `menu`: a menu or dialog, which has all keys to itself.
 * - `grid`: a list cell with neighbours, for Space and the left and right arrows. A plain row only wants Space.
 * - `button`: anything Space activates.
 */
export type FocusKind = 'none' | 'text' | 'menu' | 'grid' | 'button';

const BINDINGS = new Map<string, HotkeyAction>([
  [' ', 'togglePlaying'],
  ['ArrowLeft', 'seekBack'],
  ['ArrowRight', 'seekForward'],
  ['shift+ArrowLeft', 'seekBackFar'],
  ['shift+ArrowRight', 'seekForwardFar'],
  ['ctrl+ArrowLeft', 'previous'],
  ['ctrl+ArrowRight', 'next'],
  ['+', 'volumeUp'],
  ['=', 'volumeUp'],
  ['-', 'volumeDown'],
  ['m', 'toggleMute'],
  ['ctrl+f', 'search'],
  ['/', 'search'],
  ['Escape', 'back'],
  ['ctrl+,', 'settings'],
  ['F11', 'fullscreen'],
  ['ctrl+m', 'miniPlayer'],
  ['q', 'queue'],
  ['ctrl+shift+e', 'exclusive'],
  ['l', 'lyrics'],
  ['e', 'equalizer'],
  ['r', 'radio'],
  ['ctrl+=', 'sizeUp'],
  ['ctrl++', 'sizeUp'],
  ['ctrl+-', 'sizeDown'],
  ['ctrl+0', 'sizeReset'],
  ['?', 'help'],
]);

const REPEATS = new Set<HotkeyAction>([
  'seekBack',
  'seekForward',
  'seekBackFar',
  'seekForwardFar',
  'volumeUp',
  'volumeDown',
  'sizeUp',
  'sizeDown',
]);

const SPACE = ' ';

function isArrow(key: string): boolean {
  return key === 'ArrowLeft' || key === 'ArrowRight';
}

/** Letters by position when the layout doesn't produce Latin ones, so Q is still Q with a Georgian layout on. */
function latinLetter({ key, code }: KeyPress): string | null {
  if (/^[a-z]$/i.test(key)) return key.toLowerCase();
  return /^Key[A-Z]$/.test(code) && key.length === 1 && key !== SPACE && !/[\x20-\x7e]/.test(key)
    ? code.charAt(3).toLowerCase()
    : null;
}

function chordOf(press: KeyPress): string {
  const letter = latinLetter(press);
  const name = letter ?? press.key;
  // Shift is how you reach + or ? at all, on most layouts. It only means something on letters and named keys.
  const usesShift = press.shift && (letter !== null || name.length > 1);
  return `${press.ctrl ? 'ctrl+' : ''}${usesShift ? 'shift+' : ''}${name}`;
}

function isClaimedBy(focus: FocusKind, press: KeyPress): boolean {
  switch (focus) {
    case 'none':
      return false;
    case 'menu':
      return true;
    case 'text':
      if (press.key === 'F11' || press.key === 'Escape') return false;
      return !press.ctrl || isArrow(press.key);
    case 'grid':
      return press.key === SPACE || (isArrow(press.key) && !press.ctrl);
    case 'button':
      return press.key === SPACE;
  }
}

/** Null when the key isn't a hotkey, or belongs to what has focus. */
export function hotkeyFor(press: KeyPress, focus: FocusKind): HotkeyAction | null {
  if (press.alt || press.meta || isClaimedBy(focus, press)) return null;
  const action = BINDINGS.get(chordOf(press)) ?? null;
  return action !== null && press.repeat && !REPEATS.has(action) ? null : action;
}

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'number', 'password', 'tel', 'url']);

export function focusKindOf(target: EventTarget | null): FocusKind {
  if (!(target instanceof Element)) return 'none';
  if (target.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="menubar"], [role="listbox"]')) {
    return 'menu';
  }

  const isTextInput = target instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(target.type);
  const isEditable = target instanceof HTMLElement && target.isContentEditable;
  if (isTextInput || isEditable || target.matches('textarea, select')) return 'text';

  if ((target.closest('[data-index]')?.querySelectorAll('button').length ?? 0) > 1) return 'grid';
  return target.closest('button, a[href], summary, input') ? 'button' : 'none';
}
