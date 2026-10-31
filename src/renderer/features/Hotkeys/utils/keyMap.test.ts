import { describe, expect, it } from 'vitest';
import { focusKindOf, hotkeyFor, type FocusKind, type KeyPress } from './keyMap';

function press(key: string, extra: Partial<KeyPress> = {}): KeyPress {
  const code = /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : '';
  return { key, code, ctrl: false, shift: false, alt: false, meta: false, repeat: false, ...extra };
}

const CTRL = { ctrl: true };
const SHIFT = { shift: true };

describe('hotkeyFor', () => {
  it.each([
    [press(' '), 'togglePlaying'],
    [press('ArrowLeft'), 'seekBack'],
    [press('ArrowRight'), 'seekForward'],
    [press('ArrowLeft', SHIFT), 'seekBackFar'],
    [press('ArrowRight', SHIFT), 'seekForwardFar'],
    [press('ArrowLeft', CTRL), 'previous'],
    [press('ArrowRight', CTRL), 'next'],
    [press('+', SHIFT), 'volumeUp'],
    [press('+'), 'volumeUp'],
    [press('='), 'volumeUp'],
    [press('-'), 'volumeDown'],
    [press('m'), 'toggleMute'],
    [press('f', CTRL), 'search'],
    [press('/'), 'search'],
    [press('Escape'), 'back'],
    [press(',', CTRL), 'settings'],
    [press('F11'), 'fullscreen'],
    [press('m', CTRL), 'miniPlayer'],
    [press('q'), 'queue'],
    [press('E', { ctrl: true, shift: true }), 'exclusive'],
    [press('l'), 'lyrics'],
    [press('e'), 'equalizer'],
    [press('=', CTRL), 'sizeUp'],
    [press('+', { ctrl: true, shift: true }), 'sizeUp'],
    [press('-', CTRL), 'sizeDown'],
    [press('0', CTRL), 'sizeReset'],
    [press('?', SHIFT), 'help'],
  ])('%o is %s', (keys, action) => {
    expect(hotkeyFor(keys, 'none')).toBe(action);
  });

  it('reads letters by position under a layout without Latin ones', () => {
    expect(hotkeyFor(press('ქ', { code: 'KeyQ' }), 'none')).toBe('queue');
    expect(hotkeyFor(press('მ', { code: 'KeyM', ctrl: true }), 'none')).toBe('miniPlayer');
  });

  it('takes Caps Lock as the same letter, but Shift as a different key', () => {
    expect(hotkeyFor(press('Q'), 'none')).toBe('queue');
    expect(hotkeyFor(press('Q', SHIFT), 'none')).toBeNull();
    expect(hotkeyFor(press('E', CTRL), 'none')).toBeNull();
  });

  it.each([press('m', { alt: true }), press('ArrowLeft', { alt: true }), press(' ', { meta: true }), press('x')])(
    'leaves %o alone',
    (keys) => {
      expect(hotkeyFor(keys, 'none')).toBeNull();
    },
  );

  it('lets only the keys that step carry on while held', () => {
    expect(hotkeyFor(press('ArrowRight', { repeat: true }), 'none')).toBe('seekForward');
    expect(hotkeyFor(press('-', { repeat: true }), 'none')).toBe('volumeDown');
    expect(hotkeyFor(press(' ', { repeat: true }), 'none')).toBeNull();
    expect(hotkeyFor(press('m', { ctrl: true, repeat: true }), 'none')).toBeNull();
  });

  describe('what has focus comes first', () => {
    const claims: [FocusKind, KeyPress][] = [
      ['text', press(' ')],
      ['text', press('m')],
      ['text', press('/')],
      ['text', press('ArrowLeft')],
      ['text', press('ArrowLeft', SHIFT)],
      ['text', press('ArrowLeft', CTRL)],
      ['menu', press(' ')],
      ['menu', press('q')],
      ['menu', press('ArrowLeft', CTRL)],
      ['menu', press('F11')],
      ['grid', press(' ')],
      ['grid', press('ArrowLeft')],
      ['grid', press('ArrowRight', SHIFT)],
      ['button', press(' ')],
    ];

    it.each(claims)('%s keeps %o', (focus, keys) => {
      expect(hotkeyFor(keys, focus)).toBeNull();
    });

    const passes: [FocusKind, KeyPress, string][] = [
      ['text', press('f', CTRL), 'search'],
      ['text', press('m', CTRL), 'miniPlayer'],
      ['text', press(',', CTRL), 'settings'],
      ['text', press('F11'), 'fullscreen'],
      ['grid', press('ArrowRight', CTRL), 'next'],
      ['grid', press('m'), 'toggleMute'],
      ['button', press('ArrowLeft'), 'seekBack'],
      ['button', press('q'), 'queue'],
    ];

    it.each(passes)('%s has no use for %o', (focus, keys, action) => {
      expect(hotkeyFor(keys, focus)).toBe(action);
    });
  });
});

describe('focusKindOf', () => {
  function kindOf(html: string): FocusKind {
    document.body.innerHTML = html;
    return focusKindOf(document.querySelector('#it'));
  }

  it.each([
    ['<div id="it" tabindex="0"></div>', 'none'],
    ['<span id="it" role="slider" tabindex="0"></span>', 'none'],
    ['<input id="it" type="search" />', 'text'],
    ['<input id="it" />', 'text'],
    ['<textarea id="it"></textarea>', 'text'],
    ['<input id="it" type="checkbox" />', 'button'],
    ['<button id="it"></button>', 'button'],
    ['<button id="it" role="tab"></button>', 'button'],
    ['<div data-index="1"><button id="it"></button></div>', 'button'],
    ['<div data-index="1"><button id="it"></button><button></button></div>', 'grid'],
    ['<div role="menu"><div id="it" role="menuitem"></div></div>', 'menu'],
    ['<div role="dialog"><button id="it"></button></div>', 'menu'],
    ['<div role="dialog"><input id="it" /></div>', 'menu'],
  ])('%s is %s', (html, kind) => {
    expect(kindOf(html)).toBe(kind);
  });

  it('is none with nothing to go on', () => {
    expect(focusKindOf(null)).toBe('none');
  });
});
