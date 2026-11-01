import { AlbumCardText } from '@/components/music/AlbumCardText';
import { useListMetricsProbe } from '@/components/music/useListMetricsProbe';

/** Hidden boxes sized by the tokens a virtual list needs as numbers. One of these runs for the whole column. */
export function ListMetricsProbe() {
  const ref = useListMetricsProbe();

  return (
    <div ref={ref} aria-hidden className="pointer-events-none invisible absolute top-0 left-0 size-0 overflow-hidden">
      <div data-metric="row" className="h-row w-0" />
      <div data-metric="label" className="h-label w-0" />
      <div data-metric="card" className="h-0 w-card" />
      <div data-metric="gap" className="h-0 w-gap" />
      <div data-metric="gutter" className="h-0 w-gutter" />
      <div data-metric="listFade" className="h-list-fade w-0" />
      <div data-metric="islandClear" className="h-island-clear w-0" />
      <div data-metric="cardText" className="w-card">
        <AlbumCardText title="Ag" subtitle="Ag" />
      </div>
    </div>
  );
}
