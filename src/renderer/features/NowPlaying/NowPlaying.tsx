import { motion } from 'motion/react';
import { useState } from 'react';
import { artUrl } from '@shared/domain';
import { ArtSleeve } from '@/components/music/ArtSleeve';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { useArtSwipe } from '@/features/NowPlaying/hooks/useArtSwipe';
import { useDecodedSlide, type Slide } from '@/features/NowPlaying/hooks/useDecodedSlide';
import { toggleArtOverlay } from '@/lib/artOverlay';
import { motionDuration } from '@/lib/motionTokens';
import { usePlayer } from '@/lib/playerStore';

const MOST_LAYERS = 3;

type SlideProps = {
  slide: Slide;
};

function SlideContents({ slide }: SlideProps) {
  switch (slide.kind) {
    case 'idle':
      return (
        <span className="absolute inset-0 flex items-end bg-linear-to-br from-surface to-bg p-section">
          <Text variant="meta" color="faint">
            Nothing playing
          </Text>
        </span>
      );
    case 'waiting':
      return <span className="absolute inset-0 bg-linear-to-br from-surface to-bg" />;
    case 'sleeve':
      return <ArtSleeve title={slide.title} />;
    case 'art':
      // Decoded by now, and sync is what makes it appear whole on the first frame it's in.
      return (
        <img
          draggable={false}
          decoding="sync"
          src={artUrl(slide.hash, 'full')}
          alt={slide.title}
          className="absolute inset-0 block size-full object-cover"
        />
      );
  }
}

/**
 * The art, as big as the window allows. The new one fades in over the old, which stays whole under it, so the pane
 * never dips towards the background on the way. Another change mid-fade just stacks on top.
 */
export function NowPlaying() {
  const hash = usePlayer((state) => state.current?.artHash ?? null);
  const title = usePlayer(({ current }) => (current === null ? null : (current.album ?? current.title)));
  const slide = useDecodedSlide(hash, title);
  const [layers, setLayers] = useState([slide]);
  const duration = motionDuration('--dur-mid');
  const { followRef, handlers, wasTap } = useArtSwipe();

  // During render, so the new layer goes in with the same commit that changes the slide. With no fade to do there's
  // nothing to stack: an animation of no length still leaves a frame at its start, which would be a flash of nothing.
  if (layers.at(-1)?.key !== slide.key) {
    const under = duration === 0 ? [] : layers.filter(({ key }) => key !== slide.key);
    setLayers([...under, slide].slice(-MOST_LAYERS));
  }

  function settle(key: string): void {
    setLayers((current) => (current.at(-1)?.key === key ? current.slice(-1) : current));
  }

  return (
    <div data-testid="now-playing" className="relative size-full bg-bg">
      {/* No focus from a click, or the next Space would land here and close the lyrics rather than pause. */}
      <Button
        variant="pane"
        size="bare"
        aria-label="Lyrics"
        className="absolute inset-0 size-full touch-pan-y"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (wasTap()) toggleArtOverlay('lyrics');
        }}
        {...handlers}
      >
        <span
          ref={followRef}
          className="absolute inset-0 block transition-transform duration-(--dur-fast) ease-standard"
        >
          {layers.map((layer) => (
            <motion.span
              key={layer.key}
              initial={layers.length === 1 ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration, ease: 'easeInOut' }}
              onAnimationComplete={() => settle(layer.key)}
              className="absolute inset-0 block"
            >
              <SlideContents slide={layer} />
            </motion.span>
          ))}
        </span>
      </Button>
    </div>
  );
}
