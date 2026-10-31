import { useEffect, useState } from 'react';
import { artUrl } from '@shared/domain';

export type Slide =
  | { kind: 'idle'; key: string }
  /** Something is playing, and its art hasn't arrived yet. */
  | { kind: 'waiting'; key: string }
  | { kind: 'sleeve'; key: string; title: string }
  | { kind: 'art'; key: string; hash: string; title: string };

const IDLE: Slide = { kind: 'idle', key: 'idle' };
const WAITING: Slide = { kind: 'waiting', key: 'waiting' };

type Decoded = {
  hash: string;
  isGood: boolean;
};

function sleeveFor(title: string): Slide {
  return { kind: 'sleeve', key: `sleeve:${title}`, title };
}

/** Null while the art is on its way. */
function wantedSlide(hash: string | null, title: string | null, decoded: Decoded | null): Slide | null {
  if (title === null) return IDLE;
  if (hash === null) return sleeveFor(title);
  if (decoded?.hash !== hash) return null;
  return decoded.isGood ? { kind: 'art', key: `art:${hash}`, hash, title } : sleeveFor(title);
}

/**
 * What the pane should show now. Art takes a moment to arrive and decode, and until then the last slide stands, so a
 * change of track never flashes or shows half an image. An image that can't be had gets the sleeve, never a broken one.
 */
export function useDecodedSlide(hash: string | null, title: string | null): Slide {
  const [decoded, setDecoded] = useState<Decoded | null>(null);
  const [shown, setShown] = useState<Slide>(IDLE);

  useEffect(() => {
    if (hash === null) return;
    let isWanted = true;
    const image = new Image();
    image.src = artUrl(hash, 'full');
    image.decode().then(
      () => {
        if (isWanted) setDecoded({ hash, isGood: true });
      },
      () => {
        if (isWanted) setDecoded({ hash, isGood: false });
      },
    );
    return () => {
      isWanted = false;
    };
  }, [hash]);

  const wanted = wantedSlide(hash, title, decoded);
  if (wanted !== null && wanted.key !== shown.key) setShown(wanted);
  if (wanted !== null) return wanted;
  // "Nothing playing" can't stay up while something is.
  return shown.kind === 'idle' ? WAITING : shown;
}
