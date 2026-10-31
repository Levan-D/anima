import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/ui/Button';

describe('Button', () => {
  it('renders a real button that does not submit forms by accident', () => {
    render(<Button>Play</Button>);
    expect(screen.getByRole('button', { name: 'Play' }).getAttribute('type')).toBe('button');
  });

  it('calls onClick', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Play</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('gives an outline an edge of its own, and keeps ghost without one', () => {
    render(
      <>
        <Button variant="outline">Filled by nothing</Button>
        <Button variant="ghost">Ghost</Button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Filled by nothing' }).className).toContain('border-outline');
    expect(screen.getByRole('button', { name: 'Ghost' }).className).not.toContain('border');
  });

  it('lets className win over the defaults', () => {
    render(<Button className="px-9">Play</Button>);
    const { className } = screen.getByRole('button');
    expect(className).toContain('px-9');
    expect(className).not.toContain('px-5');
  });

  it('blocks clicks while loading, and says it is busy', () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Play
      </Button>,
    );
    const button = screen.getByRole('button');

    fireEvent.click(button);

    expect(onClick).not.toHaveBeenCalled();
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.querySelector('svg')).not.toBeNull();
  });

  it('keeps focus and its name when it starts loading, for the keyboard and screen readers', () => {
    const { rerender } = render(<Button>Rescan</Button>);
    const button = screen.getByRole('button', { name: 'Rescan' });
    button.focus();

    rerender(<Button loading>Rescan</Button>);

    expect(document.activeElement).toBe(button);
    expect(screen.getByRole('button', { name: 'Rescan' })).toBe(button);
  });

  it('does not submit a form while loading', () => {
    const onSubmit = vi.fn((event: { preventDefault(): void }) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button loading type="submit">
          Save
        </Button>
      </form>,
    );

    fireEvent.click(screen.getByRole('button'));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('is not busy otherwise', () => {
    render(<Button>Play</Button>);
    expect(screen.getByRole('button').getAttribute('aria-busy')).toBeNull();
  });

  it('forwards a ref, which Radix triggers rely on', () => {
    const ref = vi.fn();
    render(<Button ref={ref}>Play</Button>);
    expect(ref).toHaveBeenCalledWith(expect.any(HTMLButtonElement));
  });
});
