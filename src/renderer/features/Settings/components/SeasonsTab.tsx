import { useQuery } from '@tanstack/react-query';
import { SEASON_STAY_MAX, SEASONS_DEFAULT, THEMES } from '@shared/themes';
import { Collapse } from '@/components/ui/Collapse';
import { ErrorState } from '@/components/ui/ErrorState';
import { ModalSection } from '@/components/ui/ModalSection';
import { Skeleton } from '@/components/ui/Skeleton';
import { Switch } from '@/components/ui/Switch';
import { Text } from '@/components/ui/Text';
import { SeasonSlider } from '@/features/Settings/components/SeasonSlider';
import { ThemeSection } from '@/features/Settings/components/ThemeSection';
import { settingsQuery } from '@/lib/libraryQueries';
import { saveSeasons, themeContentsQuery } from '@/lib/seasons';

export function SeasonsTab() {
  const saved = useQuery({ ...settingsQuery, select: (settings) => settings.seasons });
  const contents = useQuery(themeContentsQuery);
  const seasons = saved.data ?? SEASONS_DEFAULT;

  return (
    <section aria-label="Seasons" className="flex flex-col">
      <ModalSection title="Seasons">
        <div className="flex flex-col">
          <Switch checked={seasons.isOn} onCheckedChange={(isOn) => void saveSeasons({ ...seasons, isOn })}>
            <Text className="min-w-0 flex-1">Keep seasonal songs for their season</Text>
          </Switch>
          <Text as="p" variant="meta" color="muted">
            {seasons.isOn
              ? 'Out of season they stay out of radio, Endless and More like this. In season they come up more often. You can always play them yourself'
              : 'Off, nothing is hidden or boosted'}
          </Text>
        </div>
        <Collapse open={seasons.isOn}>
          <SeasonSlider
            title="Starting from a seasonal song"
            description="How firmly a run started from one stays with its theme, at any time of year"
            label="How firmly a run stays with its theme"
            low="Drifts away"
            high="Stays"
            max={SEASON_STAY_MAX}
            value={seasons.stay}
            onCommit={(stay) => saveSeasons({ ...seasons, stay })}
          />
        </Collapse>
      </ModalSection>

      <Collapse open={seasons.isOn}>
        {contents.isError ? (
          <ErrorState error={contents.error} onRetry={() => void contents.refetch()} />
        ) : (
          THEMES.map(({ id, label }) => (
            <ThemeSection
              key={id}
              id={id}
              label={label}
              seasons={seasons}
              albums={contents.data?.[id] ?? null}
              isUpdating={contents.isFetching}
            >
              {contents.isPending ? <Skeleton className="h-16 w-full" /> : null}
            </ThemeSection>
          ))
        )}
      </Collapse>
    </section>
  );
}
