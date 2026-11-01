import type { LibraryReport, ReportSummary } from '@shared/domain';
import { Divider } from '@/components/ui/Divider';
import { Text } from '@/components/ui/Text';
import { formatBytes, formatCount, formatSpan } from '@/lib/format';
import { CheckRow } from './components/CheckRow';

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
    <header className="flex flex-col gap-gap px-gutter pt-gap pb-section">
      <div className="flex flex-col gap-1">
        <Text as="h1" variant="heading">
          Library report
        </Text>
        <Text as="p" color="muted">
          A to-do for fixing by hand in foobar2000. Nothing here changes your files
        </Text>
        <Text as="p" variant="meta" color="muted">
          Counts catch up after a Rescan
        </Text>
      </div>
      <div className="flex flex-wrap gap-x-section gap-y-gap">
        <Stat value={formatCount(tracks)} label="tracks" />
        <Stat value={formatCount(albums)} label="albums" />
        <Stat value={formatCount(artists)} label="artists" />
        <Stat value={`${losslessShare}%`} label="lossless" />
        <Stat value={formatSpan(durationMs)} label="of music" />
        <Stat value={formatBytes(sizeBytes)} label="on disk" />
        <Stat value={formatCount(toFix)} label={toFix === 1 ? 'check to look at' : 'checks to look at'} />
      </div>
    </header>
  );
}

type Props = {
  report: LibraryReport;
};

export function ReportContents({ report: { summary, groups } }: Props) {
  const toFix = groups.flatMap(({ checks }) => checks).filter(({ count, isInfo }) => count > 0 && !isInfo).length;

  return (
    <div
      data-testid="library-report"
      className="content-in flex min-h-0 flex-1 flex-col overflow-y-auto pb-island-clear"
    >
      <Summary summary={summary} toFix={toFix} />
      {groups.map(({ name, checks }) => (
        <section key={name} aria-label={name} className="flex flex-col">
          <Divider />
          <Text as="h2" variant="label" color="muted" className="px-gutter pt-section pb-2">
            {name}
          </Text>
          <ul className="flex flex-col pb-gap">
            {checks.map((check) => (
              <li key={check.id}>
                <CheckRow check={check} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
