import type { StorageInfo } from '@shared/domain';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { Field } from '@/features/Settings/components/Field';
import { RevealButton } from '@/features/Settings/components/RevealButton';
import { Section } from '@/features/Settings/components/Section';
import { revealPath } from '@/features/Settings/utils/revealPath';
import { formatBytes, formatCount, formatDateTime, joinParts } from '@/lib/format';

type CountProps = {
  value: number;
  label: string;
};

function Count({ value, label }: CountProps) {
  return (
    <div className="flex min-w-16 flex-col">
      <Text variant="title" tabular>
        {formatCount(value)}
      </Text>
      <Text variant="meta" color="muted">
        {label}
      </Text>
    </div>
  );
}

function engineLine(found: boolean, version: string | null, path: string): string {
  if (!found) return `Not found at ${path}`;
  return joinParts(version, path);
}

type Props = {
  storage: StorageInfo;
};

export function StorageSection({ storage }: Props) {
  const { counts, engine, lastChanged } = storage;

  return (
    <Section title="Storage" hideTitle>
      <div className="flex flex-wrap gap-x-section gap-y-2 pb-2">
        <Count value={counts.tracks} label="Tracks" />
        <Count value={counts.albums} label="Albums" />
        <Count value={counts.artists} label="Artists" />
        <Count value={counts.missing} label="Missing" />
      </div>

      <Field
        label={storage.databaseBytes === null ? 'Database' : `Database · ${formatBytes(storage.databaseBytes)}`}
        action={storage.databasePath === null ? null : <RevealButton target="database" what="the database" />}
      >
        {storage.databasePath ?? "Isn't open"}
      </Field>
      <Field
        label={`Art cache · ${formatBytes(storage.cacheBytes)}`}
        action={<RevealButton target="cache" what="the art cache" />}
      >
        {storage.cachePath}
      </Field>
      <Field label="Settings file" action={<RevealButton target="settings" what="the settings file" />}>
        {storage.settingsPath}
      </Field>
      <Field
        label="Logs"
        action={
          <Button variant="ghost" size="sm" onClick={() => revealPath('logs')}>
            Reveal log
          </Button>
        }
      >
        {storage.logsPath}
      </Field>

      <Field label="Library last changed">
        {lastChanged === null ? 'Not yet' : `On ${lastChanged.host} at ${formatDateTime(lastChanged.at)}`}
      </Field>
      <Field label="This machine">{storage.thisMachine}</Field>
      <Field label="mpv">{engineLine(engine.mpvFound, engine.mpvVersion, engine.mpvPath)}</Field>
      <Field label="ffmpeg">{engineLine(engine.ffmpegFound, engine.ffmpegVersion, engine.ffmpegPath)}</Field>
    </Section>
  );
}
