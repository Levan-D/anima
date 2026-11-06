import { Text } from '@/components/ui/Text';
import { useContainerLabels } from '@/app/useContainerLabels';
import { useWindowSize } from '@/hooks/useWindowSize';

const TAG = 'pointer-events-none fixed z-50 rounded-md bg-scrim-strong px-2 py-1';

/**
 * Dev builds only. Bottom left, the window's size, its Tailwind breakpoint and the layout, read from the same variants the
 * app uses, so it can't disagree with what's on screen. At each container's top right, its width and container size.
 */
export function DevBreakpoints() {
  const size = useWindowSize();
  const containers = useContainerLabels();
  return (
    <>
      <Text as="div" variant="meta" tabular aria-hidden className={`${TAG} bottom-1 left-1 flex gap-2`}>
        <span>{size}</span>
        <span className="sm:hidden">base</span>
        <span className="hidden sm:max-md:inline">sm</span>
        <span className="hidden md:max-lg:inline">md</span>
        <span className="hidden lg:max-xl:inline">lg</span>
        <span className="hidden xl:max-2xl:inline">xl</span>
        <span className="hidden 2xl:inline">2xl</span>
        <span className="hidden lg:inline">art beside the list</span>
        <span className="hidden max-lg:inline">list only</span>
      </Text>
      {containers.map((label) => (
        <Text
          key={label.key}
          as="div"
          variant="meta"
          color="accent"
          tabular
          aria-hidden
          className={`${TAG} -translate-x-full`}
          style={{ top: label.top, left: label.left }}
        >
          {label.text}
        </Text>
      ))}
    </>
  );
}
