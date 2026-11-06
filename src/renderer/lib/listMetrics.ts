/*
 * The sizes a virtual list has to know as numbers. They come from fluid tokens, which are calc() expressions a script
 * can't read, so a hidden probe in components/music measures them and writes them here. Nothing else writes to this.
 */
import { create } from 'zustand';
import { shallow } from 'zustand/shallow';

export type ListMetrics = {
  row: number;
  label: number;
  card: number;
  gap: number;
  cardText: number;
  gutter: number;
  /** How far the transport's fade reaches up over the list. */
  listFade: number;
  /** What a full-width page's list leaves clear at its end for the transport floating over it. */
  islandClear: number;
};

/** The values at 1280x800, so a list that mounts before the probe still has sensible sizes. */
const AT_LAPTOP_SIZE: ListMetrics = {
  row: 48,
  label: 42,
  card: 168,
  gap: 12,
  cardText: 44,
  gutter: 18,
  listFade: 22,
  islandClear: 250,
};

const useListMetricsStore = create<ListMetrics>()(() => AT_LAPTOP_SIZE);

export function useListMetrics(): ListMetrics {
  return useListMetricsStore();
}

export function setListMetrics(metrics: ListMetrics): void {
  if (!shallow(useListMetricsStore.getState(), metrics)) useListMetricsStore.setState(metrics);
}

type AlbumLayout = {
  lanes: number;
  /** A row of cards with the space below it, as a whole number of pixels. */
  rowHeight: number;
};

const MIN_LANES = 2;

export function albumLayout(contentWidth: number, { card, gap, cardText }: ListMetrics): AlbumLayout {
  const width = Math.max(contentWidth, 0);
  const lanes = Math.max(MIN_LANES, Math.floor((width + gap) / (card + gap)));
  const cardWidth = Math.max(width - gap * (lanes - 1), 0) / lanes;
  return { lanes, rowHeight: Math.ceil(cardWidth + cardText + gap * 2) };
}
