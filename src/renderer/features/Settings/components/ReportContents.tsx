import type { LibraryReport, ReportSummary } from '@shared/domain';
import { ModalSection } from '@/components/ui/ModalSection';
import { Text } from '@/components/ui/Text';
import { formatBytes, formatCount, formatSpan } from '@/lib/format';
import { CheckRow } from './CheckRow';

type StatProps = {
  value: string;
  label: string;
};

function Stat({ value, label }: StatProps) {
  return (
    <div className="flex min-w-0 flex-col">
      <Text variant="lead" tabular>
        {value}
      </Text>
      <Text variant="meta" color="muted">
        {label}
      </Text>
    </div>
  );
}

type SummaryProps = {
  summary: ReportSummary;
  toFix: number;
};

function Summary({ summary, toFix }: SummaryProps) {
  const { tracks, albums, artists, durationMs, sizeBytes, losslessTracks } = summary;
  const losslessShare = tracks === 0 ? 0 : Math.round((losslessTracks / tracks) * 100);

  return (
    <div className="flex flex-col gap-gap">
      <Text as="p" variant="meta" color="muted">
        What's worth fixing by hand in foobar2000. Nothing here changes your files, and the counts catch up after a
        Rescan
      </Text>
      <div className="flex flex-wrap gap-x-section gap-y-gap">
        <Stat value={formatCount(tracks)} label="tracks" />
        <Stat value={formatCount(albums)} label="albums" />
        <Stat value={formatCount(artists)} label="artists" />
        <Stat value={`${losslessShare}%`} label="lossless" />
        <Stat value={formatSpan(durationMs)} label="of music" />
        <Stat value={formatBytes(sizeBytes)} label="on disk" />
        <Stat value={formatCount(toFix)} label={toFix === 1 ? 'check to look at' : 'checks to look at'} />
      </div>
    </div>
  );
}

type Props = {
  report: LibraryReport;
};

export function ReportContents({ report: { summary, groups } }: Props) {
  const toFix = groups.flatMap(({ checks }) => checks).filter(({ count, isInfo }) => count > 0 && !isInfo).length;

  return (
    <ModalSection title="Library report">
      <div data-testid="library-report" className="content-in flex flex-col">
        <Summary summary={summary} toFix={toFix} />
        {groups.map(({ name, checks }) => (
          <section key={name} aria-label={name} className="flex flex-col">
            <Text as="h2" variant="label" color="muted" className="pt-section pb-1">
              {name}
            </Text>
            <ul className="flex flex-col">
              {checks.map((check) => (
                <li key={check.id}>
                  <CheckRow check={check} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </ModalSection>
  );
}
