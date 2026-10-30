import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jsdom has no layout, so nothing ever resizes. Tests that need sizes use stubLayout from lib/testing.
class NoResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', NoResizeObserver);
Element.prototype.scrollIntoView = () => {};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
