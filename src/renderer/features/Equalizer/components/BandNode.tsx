import { useRef, type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject } from 'react';
import { EQ_MAX_GAIN_DB, type EqBand } from '@shared/domain';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import {
  gainForNode,
  gainOfY,
  gainWords,
  hzOfX,
  hzWords,
  KIND_WORDS,
  nodeDb,
  roundHz,
  stepGain,
  stepHz,
  xOfHz,
  yOfGain,
} from '@/features/Equalizer/utils/eqBands';

const GAIN_STEP_DB = 0.5;
const GAIN_COARSE_DB = 3;
const HZ_STEP_OCTAVES = 1 / 12;
const HZ_COARSE_OCTAVES = 1 / 3;

/** Who's touching it, so a long press on a touch screen, which Chromium also calls a right-click, doesn't delete it. */
function isFromTouch({ nativeEvent }: MouseEvent): boolean {
  return nativeEvent instanceof PointerEvent && nativeEvent.pointerType === 'touch';
}

type Props = {
  /** All of them, since the node sits on the curve they make together. */
  bands: readonly EqBand[];
  band: EqBand;
  /** Its place left to right, which changes when it crosses another. */
  number: number;
  isSelected: boolean;
  plot: RefObject<HTMLDivElement | null>;
  onSelect: () => void;
  onChange: (band: EqBand, group: string) => void;
  onDragEnd: () => void;
  onRemove: () => void;
};

/** One band on the plot: across is frequency, up and down is gain. The target is finger-sized, whatever the dot looks like. */
export function BandNode({ bands, band, number, isSelected, plot, onSelect, onChange, onDragEnd, onRemove }: Props) {
  // From the pointer to the middle of the node, so taking hold of it doesn't make it jump.
  const grab = useRef<{ x: number; y: number } | null>(null);

  function onPointerDown(event: PointerEvent<HTMLButtonElement>): void {
    if (event.button !== 0) return;
    const box = event.currentTarget.getBoundingClientRect();
    grab.current = { x: event.clientX - (box.left + box.width / 2), y: event.clientY - (box.top + box.height / 2) };
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelect();
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>): void {
    const box = plot.current?.getBoundingClientRect();
    if (grab.current === null || box === undefined) return;
    const x = (event.clientX - grab.current.x - box.left) / box.width;
    const y = (event.clientY - grab.current.y - box.top) / box.height;
    const frequencyHz = roundHz(hzOfX(x));
    const gainDb = gainForNode(bands, band, frequencyHz, gainOfY(y));
    if (frequencyHz === band.frequencyHz && gainDb === band.gainDb) return;
    onChange({ ...band, frequencyHz, gainDb }, `drag-${band.id}`);
  }

  function endDrag(): void {
    if (grab.current !== null) onDragEnd();
    grab.current = null;
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    const gainBy = event.shiftKey ? GAIN_COARSE_DB : GAIN_STEP_DB;
    const hzBy = event.shiftKey ? HZ_COARSE_OCTAVES : HZ_STEP_OCTAVES;
    const moves: Record<string, Partial<EqBand>> = {
      ArrowUp: { gainDb: stepGain(band.gainDb, gainBy) },
      ArrowDown: { gainDb: stepGain(band.gainDb, -gainBy) },
      ArrowRight: { frequencyHz: stepHz(band.frequencyHz, hzBy) },
      ArrowLeft: { frequencyHz: stepHz(band.frequencyHz, -hzBy) },
    };
    const move = moves[event.key];
    if (move === undefined || event.ctrlKey || event.altKey || event.metaKey) return;
    // Otherwise the arrows go on to seek and to change the volume.
    event.preventDefault();
    onSelect();
    onChange({ ...band, ...move }, `key-${band.id}`);
  }

  function onContextMenu(event: MouseEvent<HTMLButtonElement>): void {
    event.preventDefault();
    if (!isFromTouch(event)) onRemove();
  }

  const left = `${xOfHz(band.frequencyHz) * 100}%`;
  const top = `${yOfGain(nodeDb(bands, band)) * 100}%`;

  return (
    <Button
      variant="point"
      size="bare"
      role="slider"
      data-band-id={band.id}
      aria-label={`Band ${number}`}
      aria-valuemin={-EQ_MAX_GAIN_DB}
      aria-valuemax={EQ_MAX_GAIN_DB}
      aria-valuenow={band.gainDb}
      aria-valuetext={`${KIND_WORDS[band.kind]}, ${hzWords(band.frequencyHz)}, ${gainWords(band.gainDb)}`}
      data-selected={isSelected}
      style={{ left, top }}
      onClick={onSelect}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      onContextMenu={onContextMenu}
    >
      <Text variant="meta" color="inherit" tabular>
        {number}
      </Text>
    </Button>
  );
}
