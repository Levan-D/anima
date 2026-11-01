import { useCallback } from 'react';
import { setListMetrics, type ListMetrics } from '@/lib/listMetrics';

function measure(probe: Element): ListMetrics {
  const size = (metric: keyof ListMetrics) => {
    const { width, height } = (probe.querySelector(`[data-metric="${metric}"]`) ?? probe).getBoundingClientRect();
    return { width, height };
  };

  return {
    // Whole pixels, so the rows' text stays on the pixel grid however far down the list it is.
    row: Math.round(size('row').height),
    label: Math.round(size('label').height),
    card: size('card').width,
    gap: size('gap').width,
    gutter: Math.round(size('gutter').width),
    listFade: Math.ceil(size('listFade').height),
    islandClear: Math.ceil(size('islandClear').height),
    cardText: Math.ceil(size('cardText').height),
  };
}

/**
 * A calc() custom property can't be read as a number, so this measures boxes sized by the tokens, and keeps measuring:
 * they change with the window and with the interface-size setting.
 */
export function useListMetricsProbe() {
  return useCallback((probe: HTMLDivElement | null) => {
    if (!probe) return;

    const update = () => setListMetrics(measure(probe));
    update();

    const observer = new ResizeObserver(update);
    for (const box of probe.children) observer.observe(box);
    return () => observer.disconnect();
  }, []);
}
