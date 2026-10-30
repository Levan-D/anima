import { fireEvent, render, renderHook, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { canGoBack, openAlbum, resetNavigation, useNavigation } from '@/lib/navigation';
import { useBackKeys } from '@/lib/useBackKeys';

function Mounted() {
  useBackKeys();
  return <input aria-label="A field" />;
}

const hasGoneBack = () => !renderHook(() => useNavigation(canGoBack)).result.current;

beforeEach(() => {
  resetNavigation();
  openAlbum(1);
  render(<Mounted />);
});

describe('useBackKeys', () => {
  it.each([
    ['Escape', { key: 'Escape' }],
    ['Alt+Left', { key: 'ArrowLeft', altKey: true }],
    ['Backspace', { key: 'Backspace' }],
  ])('%s goes back', (_name, init) => {
    fireEvent.keyDown(window, init);
    expect(hasGoneBack()).toBe(true);
  });

  it('Left on its own does not', () => {
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(hasGoneBack()).toBe(false);
  });

  it('Backspace in a field is typing', () => {
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Backspace' });
    expect(hasGoneBack()).toBe(false);
  });

  it('Alt+Left still works from a field', () => {
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'ArrowLeft', altKey: true });
    expect(hasGoneBack()).toBe(true);
  });

  it('leaves alone an Escape something on top has used', () => {
    const taken = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    taken.preventDefault();
    window.dispatchEvent(taken);
    expect(hasGoneBack()).toBe(false);
  });

  it('does not go anywhere under an open dialog', () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.append(dialog);
    fireEvent.keyDown(window, { key: 'Backspace' });
    fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true });
    expect(hasGoneBack()).toBe(false);
    dialog.remove();
  });
});
