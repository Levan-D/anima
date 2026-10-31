import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

function Controlled({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Opener</Button>
      <Modal
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          onOpenChange?.(next);
        }}
        title="Something"
        closeLabel="Close it"
      >
        <Button>Inside</Button>
      </Modal>
    </>
  );
}

function openIt() {
  const opener = screen.getByRole('button', { name: 'Opener' });
  opener.focus();
  fireEvent.click(opener);
}

describe('Modal', () => {
  it('is a dialog named by its title', () => {
    render(<Modal defaultOpen title="Something" />);
    expect(screen.getByRole('dialog', { name: 'Something' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Something' })).toBeTruthy();
  });

  it('takes its size from a token, whatever the caller adds', () => {
    render(<Modal defaultOpen title="Big" size="lg" className="extra" />);
    const { className } = screen.getByRole('dialog');
    expect(className).toContain('w-270');
    expect(className).toContain('max-w-full');
    expect(className).toContain('extra');
  });

  it('has a close button only when it is given a name for one', () => {
    render(<Modal defaultOpen title="Something" />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('Escape closes it and gives focus back to what had it', async () => {
    const onOpenChange = vi.fn();
    render(<Controlled onOpenChange={onOpenChange} />);
    openIt();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close it' })));

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

    expect(onOpenChange).toHaveBeenCalledWith(false);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Opener' }));
  });

  it('the close button closes it', async () => {
    render(<Controlled />);
    openIt();
    fireEvent.click(await screen.findByRole('button', { name: 'Close it' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('a press outside closes it, unless it lands on a toast', async () => {
    const outside = document.createElement('div');
    const toast = document.createElement('div');
    toast.setAttribute('data-toast', '');
    document.body.append(outside, toast);
    const onOpenChange = vi.fn();
    render(<Controlled onOpenChange={onOpenChange} />);
    openIt();
    await screen.findByRole('dialog');
    // Radix waits a tick before listening, so the press that opened it doesn't close it.
    await act(() => new Promise((done) => setTimeout(done, 10)));

    fireEvent.pointerDown(toast);
    fireEvent.click(toast);
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.pointerDown(outside);
    fireEvent.click(outside);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    outside.remove();
    toast.remove();
  });

  it('a caller can say where focus starts', async () => {
    const atStart = (event: Event) => {
      event.preventDefault();
      if (event.currentTarget instanceof Element)
        event.currentTarget.querySelector<HTMLElement>('[data-first]')?.focus();
    };
    render(
      <Modal defaultOpen title="Something" closeLabel="Close it" onOpenAutoFocus={atStart}>
        <Button data-first>Here</Button>
      </Modal>,
    );
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Here' })));
  });

  it('keeps Tab inside', async () => {
    render(<Controlled />);
    openIt();
    const dialog = await screen.findByRole('dialog');
    const close = screen.getByRole('button', { name: 'Close it' });
    const inside = screen.getByRole('button', { name: 'Inside' });
    await waitFor(() => expect(document.activeElement).toBe(close));
    inside.focus();

    // Past the last one, it comes round to the first rather than leaving.
    fireEvent.keyDown(inside, { key: 'Tab' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(close);
  });
});
