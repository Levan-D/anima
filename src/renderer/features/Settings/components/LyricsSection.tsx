import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { ModalSection } from '@/components/ui/ModalSection';
import { Switch } from '@/components/ui/Switch';
import { Text } from '@/components/ui/Text';
import { call } from '@/lib/api';
import { settingsQuery } from '@/lib/libraryQueries';
import { useImportLyrics } from '@/lib/lyricsActions';

export function LyricsSection() {
  const { data: isOnline = false } = useQuery({ ...settingsQuery, select: (settings) => settings.fetchLyricsOnline });
  const importLyrics = useImportLyrics();

  return (
    <section aria-label="Lyrics" className="flex flex-col">
      <ModalSection title="Online">
        <Switch checked={isOnline} onCheckedChange={(on) => void call('settings.update', { fetchLyricsOnline: on })}>
          <Text className="min-w-0 flex-1">Look up lyrics on LRCLIB</Text>
        </Switch>
        <Text as="p" variant="meta" color="muted">
          When a track has no lyrics, asks the free LRCLIB service, sending only names and the track's length. Off, it
          only asks when you search or press Update in Data
        </Text>
      </ModalSection>
      <ModalSection title="Lyrics library">
        <Text as="p" variant="meta" color="muted">
          Adds lyrics from a lyrics.db file you already have, matched to your tracks by their audio, all on this PC
        </Text>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="md" loading={importLyrics.isPending} onClick={() => importLyrics.mutate()}>
            Import lyrics library
          </Button>
        </div>
      </ModalSection>
    </section>
  );
}
