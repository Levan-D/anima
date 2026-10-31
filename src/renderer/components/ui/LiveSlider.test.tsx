import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { LiveSlider, type LiveSliderHandle } from '@/components/ui/LiveSlider';

function mount(overrides: Partial<Parameters<typeof LiveSlider>[0]> = {}) {
  const ref = createRef<LiveSliderHandle>();
  const props = { onDrag: vi.fn(), onDragEnd: vi.fn(), onKeyDown: vi.fn() };
  const { container } = render(<LiveSlider ref={ref} label="Seek" max={200} {...props} {...overrides} />);
  const part = (slot: string) => container.querySelector(`[data-slot="${slot}"]`) as HTMLElement;
  return {
    ...props,
    handle: () => ref.current as LiveSliderHandle,
    thumb: () => screen.getByRole('slider', { name: 'Seek' }),
    root: () => container.firstElementChild as HTMLElement,
    fill: () => part('fill'),
  };
}

/** Radix goes by these, and jsdom doesn't have them. */
function stubCapture(element: HTMLElement): void {
  let captured = false;
  element.setPointerCapture = () => {
    captured = true;
  };
  element.releasePointerCapture = () => {
    captured = false;
  };
  element.hasPointerCapture = () => captured;
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    bottom: 44,
    right: 400,
    width: 400,
    height: 44,
    toJSON: () => ({}),
  });
}

describe('LiveSlider', () => {
  it('names the thumb, and says where it is in words once told', () => {
    const { handle, thumb } = mount();
    handle().show(50, 200, '0:50 of 3:20');
    expect(thumb().getAttribute('aria-valuenow')).toBe('50');
    expect(thumb().getAttribute('aria-valuetext')).toBe('0:50 of 3:20');
    expect(thumb().getAttribute('aria-valuemax')).toBe('200');
  });

  it('draws with transforms, as a fraction of the line', () => {
    const { handle, fill } = mount();
    handle().show(50, 200, '');
    expect(fill().style.transform).toBe('scaleX(0.25)');
  });

  it('stays inside the line, whatever it is told', () => {
    const { handle, fill } = mount();
    handle().show(500, 200, '');
    expect(fill().style.transform).toBe('scaleX(1)');
    handle().show(-5, 200, '');
    expect(fill().style.transform).toBe('scaleX(0)');
    handle().show(5, 0, '');
    expect(fill().style.transform).toBe('scaleX(0)');
  });

  it('leaves the DOM alone for a move too small to see, and still gets to the ends exactly', () => {
    const { handle, fill } = mount();
    handle().show(500_000, 1_000_000, '');
    expect(fill().style.transform).toBe('scaleX(0.5)');

    handle().show(500_001, 1_000_000, '');
    expect(fill().style.transform).toBe('scaleX(0.5)');

    handle().show(1_000_000, 1_000_000, '');
    expect(fill().style.transform).toBe('scaleX(1)');
  });

  it('leaves the keys to its caller, who stops Radix by preventing the event', () => {
    const onKeyDown = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    const { thumb, onDrag } = mount({ onKeyDown });

    fireEvent.keyDown(thumb(), { key: 'ArrowRight' });
    fireEvent.keyDown(thumb(), { key: 'Home' });

    expect(onKeyDown).toHaveBeenCalledTimes(2);
    expect(onDrag).not.toHaveBeenCalled();
  });

  it('a press goes straight to where it landed, and letting go ends it', () => {
    const { root, onDrag, onDragEnd } = mount();
    stubCapture(root());

    fireEvent.pointerDown(root(), { button: 0, clientX: 100, pointerId: 1 });
    expect(onDrag).toHaveBeenLastCalledWith(50);
    expect(root().hasAttribute('data-dragging')).toBe(true);

    fireEvent.pointerMove(root(), { clientX: 300, pointerId: 1 });
    expect(onDrag).toHaveBeenLastCalledWith(150);
    expect(onDragEnd).not.toHaveBeenCalled();

    fireEvent.pointerUp(root(), { clientX: 300, pointerId: 1 });
    expect(onDragEnd).toHaveBeenCalledWith(true);
    expect(root().hasAttribute('data-dragging')).toBe(false);
  });

  it('reports a move all the way to the start, which a slider usually skips as no change', () => {
    const { root, onDrag } = mount();
    stubCapture(root());

    fireEvent.pointerDown(root(), { button: 0, clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(root(), { clientX: -40, pointerId: 1 });

    expect(onDrag).toHaveBeenLastCalledWith(0);
  });

  it('a cancelled drag says so', () => {
    const { root, onDragEnd } = mount();
    stubCapture(root());

    fireEvent.pointerDown(root(), { button: 0, clientX: 100, pointerId: 1 });
    fireEvent.pointerCancel(root(), { pointerId: 1 });

    expect(onDragEnd).toHaveBeenCalledWith(false);
  });

  it('only the main button drags', () => {
    const { root, onDrag, onDragEnd } = mount();
    stubCapture(root());

    fireEvent.pointerDown(root(), { button: 2, clientX: 100, pointerId: 1 });
    fireEvent.pointerUp(root(), { button: 2, clientX: 100, pointerId: 1 });

    expect(onDrag).not.toHaveBeenCalled();
    expect(onDragEnd).not.toHaveBeenCalled();
  });

  it('can not be focused or dragged when disabled', () => {
    const { thumb, root, onDrag } = mount({ disabled: true });
    stubCapture(root());
    expect(thumb().getAttribute('tabindex')).toBeNull();
    fireEvent.pointerDown(root(), { button: 0, clientX: 100, pointerId: 1 });
    expect(onDrag).not.toHaveBeenCalled();
  });
});
