import { useEffect, useState } from 'react';

export type ContainerLabel = {
  key: string;
  top: number;
  left: number;
  text: string;
};

// Tailwind's own container sizes, at the 16px rem this app keeps.
const SIZES: readonly (readonly [string, number])[] = [
  ['@7xl', 1280],
  ['@6xl', 1152],
  ['@5xl', 1024],
  ['@4xl', 896],
  ['@3xl', 768],
  ['@2xl', 672],
  ['@xl', 576],
  ['@lg', 512],
  ['@md', 448],
  ['@sm', 384],
  ['@xs', 320],
  ['@2xs', 288],
  ['@3xs', 256],
];

const CONTAINERS = '[class~="@container"], [class*="@container/"], [class*="@container-size"]';
// Small ones, such as each album card's, would bury the screen in labels.
const SMALLEST = 200;
const MOST = 12;

function sizeName(width: number): string {
  return SIZES.find(([, at]) => width >= at)?.[0] ?? 'under @3xs';
}

function nameOf(element: Element): string {
  const named = [...element.classList].find(
    (name) => name.startsWith('@container/') || name.startsWith('@container-size/'),
  );
  return named ? named.slice(named.indexOf('/') + 1) : '';
}

function measure(): ContainerLabel[] {
  return [...document.querySelectorAll(CONTAINERS)]
    .map((element, index) => ({ element, box: element.getBoundingClientRect(), index }))
    .filter(({ box }) => box.width >= SMALLEST && box.height > 0 && box.bottom > 0 && box.top < innerHeight)
    .slice(0, MOST)
    .map(({ element, box, index }) => ({
      key: String(index),
      top: Math.max(0, box.top),
      left: Math.max(0, box.right),
      text: `${nameOf(element)} ${Math.round(box.width)} ${sizeName(box.width)}`.trim(),
    }));
}

/** Dev builds only: every sizable container on screen, its width and which Tailwind container size that is. */
export function useContainerLabels(): ContainerLabel[] {
  const [labels, setLabels] = useState<ContainerLabel[]>([]);
  useEffect(() => {
    const update = () =>
      setLabels((now) => {
        const next = measure();
        return JSON.stringify(next) === JSON.stringify(now) ? now : next;
      });
    update();
    const timer = setInterval(update, 500);
    return () => clearInterval(timer);
  }, []);
  return labels;
}
