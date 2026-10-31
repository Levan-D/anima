import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { albumLayout, setListMetrics, useListMetrics, type ListMetrics } from '@/lib/listMetrics';

const AT_1280: ListMetrics = { row: 48, label: 42, card: 168, gap: 12, cardText: 44, gutter: 18, listFade: 22 };
const AT_1920: ListMetrics = { row: 52, label: 45, card: 181.4, gap: 12.96, cardText: 47, gutter: 19, listFade: 24 };
const AT_3840: ListMetrics = { row: 104, label: 91, card: 362.9, gap: 25.92, cardText: 94, gutter: 39, listFade: 47 };

describe('albumLayout', () => {
  it('fits two lanes at about 480 px of list width', () => {
    expect(albumLayout(437, AT_1280).lanes).toBe(2);
  });

  it('fits more on a bigger screen, the same number on a TV as at 1080p because the unit grows with it', () => {
    expect(albumLayout(796, AT_1920).lanes).toBe(4);
    expect(albumLayout(1592, AT_3840).lanes).toBe(4);
  });

  it('never goes below two lanes, or breaks with no width yet', () => {
    expect(albumLayout(120, AT_1280).lanes).toBe(2);
    expect(albumLayout(0, AT_1280).lanes).toBe(2);
    expect(albumLayout(-10, AT_1280).rowHeight).toBeGreaterThan(0);
  });

  it('makes a row tall enough for a square of the width each lane gets, the text and a gap, in whole pixels', () => {
    const { rowHeight } = albumLayout(437, AT_1280);
    const cardWidth = (437 - 12) / 2;
    expect(rowHeight).toBe(Math.ceil(cardWidth + 44 + 24));
    expect(Number.isInteger(rowHeight)).toBe(true);
  });
});

describe('the metrics store', () => {
  it('keeps the same object when nothing changed, so nothing re-renders for a resize that moved nothing', () => {
    setListMetrics(AT_1280);
    const { result, rerender } = renderHook(() => useListMetrics());
    const before = result.current;

    setListMetrics({ ...AT_1280 });
    rerender();
    expect(result.current).toBe(before);

    setListMetrics(AT_1920);
    rerender();
    expect(result.current).toEqual(AT_1920);
  });
});
