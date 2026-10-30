import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Slider } from '@/components/ui/Slider';

class NoResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', NoResizeObserver);
});

describe('Slider', () => {
  it('names the thumb and reports its value', () => {
    render(<Slider label="Volume" value={60} onValueChange={() => {}} />);
    const thumb = screen.getByRole('slider', { name: 'Volume' });
    expect(thumb.getAttribute('aria-valuenow')).toBe('60');
  });

  it('hands out a number, not an array', () => {
    const onValueChange = vi.fn();
    render(<Slider label="Volume" value={60} onValueChange={onValueChange} />);

    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight' });

    expect(onValueChange).toHaveBeenCalledWith(61);
  });

  it('respects its range and step', () => {
    const onValueChange = vi.fn();
    render(<Slider label="Volume" value={10} min={10} max={20} step={5} onValueChange={onValueChange} />);

    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight' });

    expect(onValueChange).toHaveBeenCalledWith(15);
  });

  it('does nothing when disabled', () => {
    const onValueChange = vi.fn();
    render(<Slider disabled label="Volume" value={60} onValueChange={onValueChange} />);

    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight' });

    expect(onValueChange).not.toHaveBeenCalled();
  });
});
