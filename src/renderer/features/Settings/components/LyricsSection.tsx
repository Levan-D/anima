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
      <ModalSection title="Lyrics online">
        <Switch checked={isOnline} onCheckedChange={(on) => void call('settings.update', { fetchLyricsOnline: on })}>
          <Text className="min-w-0 flex-1">Look up lyrics on LRCLIB</Text>
        </Switch>
        <Text as="p" variant="meta" color="muted">
          When you open the lyrics of a song that has none on this PC, asks the free LRCLIB service for them, sending
          only the song's name and length. It doesn't ask for songs as they play. Off, it only asks when you search, or
          press Update on Lyrics above. Asks lrclib.net
        </Text>
      </ModalSection>
      <ModalSection title="Lyrics library">
        <Text as="p" variant="meta" color="muted">
          Adds lyrics from a lyrics.db file made by this app's lyrics tool, such as one from another PC with the same
          music. Songs are matched by their audio, so file names and folders don't matter. Nothing leaves this PC
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
