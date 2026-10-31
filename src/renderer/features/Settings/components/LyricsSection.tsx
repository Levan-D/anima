import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { Text } from '@/components/ui/Text';
import { Section } from '@/features/Settings/components/Section';
import { call } from '@/lib/api';
import { settingsQuery } from '@/lib/libraryQueries';
import { useImportLyrics } from '@/lib/lyricsActions';

export function LyricsSection() {
  const { data: isOnline = false } = useQuery({ ...settingsQuery, select: (settings) => settings.fetchLyricsOnline });
  const importLyrics = useImportLyrics();

  return (
    <Section title="Lyrics" hideTitle>
      <Switch checked={isOnline} onCheckedChange={(on) => void call('settings.update', { fetchLyricsOnline: on })}>
        <Text className="min-w-0 flex-1">Look up lyrics on LRCLIB</Text>
      </Switch>
      <div className="flex flex-wrap gap-2">
        <Button loading={importLyrics.isPending} onClick={() => importLyrics.mutate()}>
          Import lyrics library
        </Button>
      </div>
      <Text as="p" variant="meta" color="muted">
        Matches a lyrics.db to this library by its audio
      </Text>
    </Section>
  );
}
