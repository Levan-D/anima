import { artUrl } from '@shared/domain';
import { LEAVING_ATTRIBUTE } from '@/hooks/useHoverPresence';

type Props = {
  hash: string | null;
};

/**
 * The record inside a sleeve, drawn in `.vinyl-disc` in globals.css with the album's art for a label. It sits behind the
 * sleeve and CSS slides it out while the button around it is hovered or focused. Goes behind the sleeve in the same box.
 */
export function VinylDisc({ hash }: Props) {
  return (
    <span aria-hidden className="vinyl-disc" {...{ [LEAVING_ATTRIBUTE]: true }}>
      <span className="vinyl-label">
        {hash === null ? null : (
          <img draggable={false} decoding="async" src={artUrl(hash, 'thumb')} alt="" className="block size-full object-cover" />
        )}
      </span>
    </span>
  );
}
