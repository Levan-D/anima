import { fireEvent, render, screen } from '@testing-library/react';
import { Play } from 'lucide-react';
import { Tooltip as RadixTooltip } from 'radix-ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/ui/Button';
import { DropdownMenu } from '@/components/ui/DropdownMenu';
import type { MenuEntry } from '@/components/ui/menuEntries';
import { Tooltip } from '@/components/ui/Tooltip';

class NoResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const onPlay = vi.fn();
const onRemove = vi.fn();

const ENTRIES: MenuEntry[] = [
  { kind: 'label', label: 'This track' },
  { kind: 'item', label: 'Play next', icon: Play, shortcut: 'Ctrl+N', onSelect: onPlay },
  { kind: 'item', label: 'Not right now', disabled: true, onSelect: () => {} },
  { kind: 'separator' },
  { kind: 'item', label: 'Remove', destructive: true, onSelect: onRemove },
];

function openMenu() {
  render(
    <DropdownMenu entries={ENTRIES}>
      <Button>Menu</Button>
    </DropdownMenu>,
  );
  fireEvent.keyDown(screen.getByRole('button', { name: 'Menu' }), { key: 'Enter' });
}

beforeEach(() => {
  onPlay.mockClear();
  onRemove.mockClear();
  vi.stubGlobal('ResizeObserver', NoResizeObserver);
});

describe('DropdownMenu', () => {
  it('renders every kind of entry', () => {
    openMenu();
    expect(screen.getByText('This track')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /Play next/ })).toBeTruthy();
    expect(screen.getByText('Ctrl+N')).toBeTruthy();
    expect(screen.getByRole('separator')).toBeTruthy();
  });

  it('runs the item that is chosen', () => {
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));
    expect(onRemove).toHaveBeenCalledOnce();
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('marks a disabled item', () => {
    openMenu();
    expect(screen.getByRole('menuitem', { name: 'Not right now' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('menuitem', { name: 'Remove' }).hasAttribute('aria-disabled')).toBe(false);
  });

  it('still opens with a tooltip between it and the button', () => {
    render(
      <DropdownMenu entries={ENTRIES}>
        <Tooltip label="More">
          <Button>Menu</Button>
        </Tooltip>
      </DropdownMenu>,
      { wrapper: RadixTooltip.Provider },
    );

    fireEvent.keyDown(screen.getByRole('button', { name: 'Menu' }), { key: 'Enter' });

    expect(screen.getByRole('menuitem', { name: 'Remove' })).toBeTruthy();
  });
});
