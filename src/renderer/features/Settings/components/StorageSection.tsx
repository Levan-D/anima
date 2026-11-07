import type { StorageInfo } from '@shared/domain';
import { Field } from '@/components/ui/Field';
import { ModalSection } from '@/components/ui/ModalSection';
import { Text } from '@/components/ui/Text';
import { RevealButton } from '@/features/Settings/components/RevealButton';
import { formatBytes, formatDateTime, joinParts } from '@/lib/format';

function engineLine(found: boolean, version: string | null, path: string): string {
  if (!found) return `Not found at ${path}`;
  return joinParts(version, path);
}

type Props = {
  storage: StorageInfo;
};

export function StorageSection({ storage }: Props) {
  const { engine, lastChanged } = storage;

  return (
    <section aria-label="Storage" className="flex flex-col">
      <ModalSection title="Across PCs">
        <Field
          label="Library last changed"
          description="Which PC last changed this library, in case you use it on more than one"
        >
          {lastChanged === null ? 'Not yet' : `On ${lastChanged.host} at ${formatDateTime(lastChanged.at)}`}
        </Field>
        <Field label="This machine">{storage.thisMachine}</Field>
      </ModalSection>

      <ModalSection title="Files">
        <Field
          label={storage.databaseBytes === null ? 'Your data' : `Your data · ${formatBytes(storage.databaseBytes)}`}
          description="One folder beside your music, which goes wherever it goes: playlists, stats, lyrics, fingerprints, Discover data, and your EQ, seasons, radio and headphones. Your music files aren't in it"
          action={storage.databasePath === null ? null : <RevealButton target="database" what="your data" />}
        >
          {storage.databasePath ?? "Isn't open"}
        </Field>
        <Field
          label={`Art cache · ${formatBytes(storage.cacheBytes)}`}
          description="Small copies of your album art, so lists load fast"
          action={<RevealButton target="cache" what="the art cache" />}
        >
          {storage.cachePath}
        </Field>
        <Field
          label="This PC's settings"
          description="Where your music is, and what depends on this PC: volume, output, interface size, staying awake and where the windows were"
          action={<RevealButton target="settings" what="this PC's settings" />}
        >
          {storage.settingsPath}
        </Field>
        <Field
          label="Logs"
          description="What the app noted as it ran, useful when something goes wrong"
          action={<RevealButton target="logs" what="the logs" />}
        >
          {storage.logsPath}
        </Field>
      </ModalSection>

      <ModalSection title="Engine">
        <Text as="p" variant="meta" color="muted">
          mpv plays your music. ffmpeg reads it for waveforms and fingerprints, and shrinks album art
        </Text>
        <Field label="mpv">{engineLine(engine.mpvFound, engine.mpvVersion, engine.mpvPath)}</Field>
        <Field label="ffmpeg">{engineLine(engine.ffmpegFound, engine.ffmpegVersion, engine.ffmpegPath)}</Field>
      </ModalSection>
    </section>
  );
}
