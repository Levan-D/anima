import type { Track } from '@shared/domain';
import type { MusicSection } from '@/components/music/listItems';

/** An album's tracks, with a heading for each disc once there's more than one. They arrive sorted by disc and track. */
export function albumSections(tracks: Track[]): MusicSection[] {
  const discs = new Map<number, Track[]>();
  for (const track of tracks) {
    const disc = track.discNumber ?? 1;
    const onDisc = discs.get(disc);
    if (onDisc) onDisc.push(track);
    else discs.set(disc, [track]);
  }

  if (discs.size <= 1) return [{ kind: 'tracks', tracks, numbered: true }];

  return [...discs].flatMap(([disc, onDisc]): MusicSection[] => [
    { kind: 'label', text: `Disc ${disc}` },
    { kind: 'tracks', tracks: onDisc, numbered: true },
  ]);
}
