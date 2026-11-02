import { useQuery } from '@tanstack/react-query';
import { isInWindow, monthDayOf, SEASONS_DEFAULT, THEMES, type Seasons } from '@shared/themes';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { Text } from '@/components/ui/Text';
import { settingsQuery } from '@/lib/libraryQueries';
import { saveSeasons } from '@/lib/seasons';

function inSeasonWords({ isOn, themes }: Seasons): string {
  if (!isOn) return 'Off, nothing is hidden or boosted';
  const today = monthDayOf(new Date());
  const now = THEMES.filter(({ id }) => isInWindow(today, themes[id].from, themes[id].to)).map(({ label }) => label);
  const season = now.length === 0 ? 'Nothing is in season now' : `In season now: ${now.join(', ')}`;
  return `${season}. Also applies to Endless and More like this`;
}

export function SeasonsLine({ onOpenSettings }: { onOpenSettings: () => void }) {
  const saved = useQuery({ ...settingsQuery, select: (settings) => settings.seasons });
  const seasons = saved.data ?? SEASONS_DEFAULT;

  return (
    <section aria-label="Seasons" className="flex shrink-0 flex-col px-gutter pt-gutter">
      <Switch checked={seasons.isOn} onCheckedChange={(isOn) => void saveSeasons({ ...seasons, isOn })}>
        <Text className="min-w-0 flex-1">Seasons</Text>
      </Switch>
      <div className="flex flex-wrap items-center gap-x-gap">
        <Text as="p" variant="meta" color="muted" className="min-w-0 flex-1">
          {inSeasonWords(seasons)}
        </Text>
        <Button variant="ghost" onClick={onOpenSettings}>
          Settings → Seasons
        </Button>
      </div>
    </section>
  );
}
