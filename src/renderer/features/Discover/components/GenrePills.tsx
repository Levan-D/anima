import { memo, useMemo } from 'react';
import type { DiscoverList } from '@shared/domain';
import { Divider } from '@/components/ui/Divider';
import { Fade } from '@/components/ui/Fade';
import { PillGroup } from '@/components/ui/PillGroup';
import { cn } from '@/lib/cn';
import { setMainGenres, setSubGenres, useMainGenres, useSubGenres } from '../discoverFilter';
import { mainGenrePills, subGenrePills } from '../utils/suggestions';

type Props = {
  list: DiscoverList;
};

export const GenrePills = memo(function GenrePills({ list }: Props) {
  const mains = useMainGenres();
  const subs = useSubGenres();
  const isFiltered = mains.length > 0;
  const mainPills = useMemo(() => mainGenrePills(list.artists, mains), [list.artists, mains]);
  const subPills = useMemo(() => subGenrePills(list.genres, mains), [list.genres, mains]);

  if (mainPills.length === 0) return null;

  return (
    // The full set keeps its place while it's hidden, so picking a genre moves nothing below.
    <div className="relative mb-2 shrink-0">
      <PillGroup
        label="Filter by genre"
        items={mainPills}
        value={mains}
        onValueChange={setMainGenres}
        rows={2}
        isInset
        className={cn(
          'transition-[opacity,visibility] duration-(--dur-mid) ease-standard',
          isFiltered && 'invisible opacity-0',
        )}
      />
      <Fade show={isFiltered} className="absolute inset-0 flex items-start gap-1.5 px-gutter">
        <PillGroup
          label="Chosen genre, press to go back"
          items={mainPills.filter(({ value }) => mains.includes(value))}
          value={mains}
          onValueChange={setMainGenres}
          rows={1}
          className="w-auto"
        />
        <Divider orientation="vertical" className="mx-1 self-stretch" />
        <PillGroup
          label="Narrow by sub genre"
          isSecondary
          items={subPills}
          value={subs}
          onValueChange={setSubGenres}
          rows={2}
          className="w-auto min-w-0 flex-1"
        />
      </Fade>
    </div>
  );
});
