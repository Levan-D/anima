import type { ReactNode } from 'react';
import {
  daysInMonth,
  isInWindow,
  monthDayOf,
  SEASON_BOOST_MAX,
  type MonthDay,
  type Seasons,
  type ThemedAlbum,
  type ThemeId,
} from '@shared/themes';
import { Button } from '@/components/ui/Button';
import { DropdownMenu } from '@/components/ui/DropdownMenu';
import { ModalSection } from '@/components/ui/ModalSection';
import { Text } from '@/components/ui/Text';
import { ValueStepper } from '@/components/ui/ValueStepper';
import { SeasonSlider } from '@/features/Settings/components/SeasonSlider';
import { ThemedAlbumRow } from '@/features/Settings/components/ThemedAlbumRow';
import { saveSeasons } from '@/lib/seasons';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

function withDay(month: number, day: number): MonthDay {
  return { month, day: Math.min(Math.max(day, 1), daysInMonth(month)) };
}

type DateProps = {
  name: string;
  date: MonthDay;
  onChange: (date: MonthDay) => void;
};

function DatePicker({ name, date: { month, day }, onChange }: DateProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Text variant="meta" color="muted">
        {name}
      </Text>
      <DropdownMenu
        entries={MONTHS.map((label, index) => ({
          kind: 'item',
          label,
          onSelect: () => onChange(withDay(index + 1, day)),
        }))}
      >
        <Button variant="outline" size="sm" aria-label={`${name} month`}>
          {MONTHS[month - 1]}
        </Button>
      </DropdownMenu>
      <ValueStepper
        name={`${name} day`}
        isNameVisible={false}
        value={String(day)}
        onLower={() => onChange(withDay(month, day - 1))}
        onRaise={() => onChange(withDay(month, day + 1))}
        onType={(text) => {
          const typed = Number(text);
          if (Number.isInteger(typed)) onChange(withDay(month, typed));
        }}
      />
    </div>
  );
}

type Props = {
  id: ThemeId;
  label: string;
  seasons: Seasons;
  /** Null until they've been read. */
  albums: readonly ThemedAlbum[] | null;
  /** The first read of the library can take a few seconds. */
  isUpdating: boolean;
  /** Takes the list's place while it's being read. */
  children: ReactNode;
};

export function ThemeSection({ id, label, seasons, albums, isUpdating, children }: Props) {
  const season = seasons.themes[id];
  const isInSeason = isInWindow(monthDayOf(new Date()), season.from, season.to);
  const save = (change: Partial<typeof season>) =>
    saveSeasons({ ...seasons, themes: { ...seasons.themes, [id]: { ...season, ...change } } });

  return (
    <ModalSection title={label}>
      <Text as="p" variant="meta" color="muted">
        {isInSeason ? 'In season now' : 'Out of season now'}
        {isUpdating ? ', updating the list' : ''}
      </Text>
      <div className="flex flex-wrap items-center gap-x-section gap-y-2">
        <DatePicker name="From" date={season.from} onChange={(from) => void save({ from })} />
        <DatePicker name="To" date={season.to} onChange={(to) => void save({ to })} />
      </div>
      <SeasonSlider
        title="How much more often in season"
        description="It still has to fit what's playing, so a song far from it stays away"
        label={`How much more often ${label} songs come up in season`}
        low="No more than usual"
        high="Much more"
        max={SEASON_BOOST_MAX}
        value={season.boost}
        onCommit={(boost) => save({ boost })}
      />
      {children}
      {albums !== null && albums.length === 0 ? (
        <Text as="p" variant="meta" color="muted">
          Nothing yet. Right-click a song, then Season theme, to add it, its album or its artist
        </Text>
      ) : null}
      {albums !== null && albums.length > 0 ? (
        <ul className="content-in flex flex-col">
          {albums.map((album) => (
            <ThemedAlbumRow
              key={`${album.albumId ?? album.artist}`}
              theme={id}
              themeLabel={label}
              album={album}
            />
          ))}
        </ul>
      ) : null}
    </ModalSection>
  );
}
