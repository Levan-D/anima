import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import type { ReportCheck, Track } from '@shared/domain';
import { DetailHeader } from '@/components/music/DetailHeader';
import { ListSkeleton } from '@/components/music/ListSkeleton';
import { AlbumArt } from '@/components/music/AlbumArt';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Text } from '@/components/ui/Text';
import { formatPlural, joinParts } from '@/lib/format';
import { issuesQuery, reportTracksQuery } from '@/lib/libraryQueries';
import { goBack } from '@/lib/navigation';
import { closeReportCheck } from '@/lib/pages';

type TracksProps = {
  check: ReportCheck;
  tracks: Track[];
};

/** What to look at in foobar2000, not something to play: the report only ever informs. */
function CheckTracks({ check: { name, description }, tracks }: TracksProps) {
  return (
    <div className="content-in flex min-h-0 flex-1 flex-col overflow-y-auto pb-section">
      <DetailHeader title={name} meta={formatPlural(tracks.length, 'track')}>
        <Text as="p" color="muted">
          {description}
        </Text>
      </DetailHeader>
      <ul className="flex flex-col px-gutter">
        {tracks.map((track) => (
          <li
            key={track.id}
            className="flex min-h-row items-center gap-gap [contain-intrinsic-size:auto_3em] [content-visibility:auto]"
          >
            <AlbumArt hash={track.artHash} title={track.album ?? track.title} className="size-10 shrink-0" />
            <span className="flex min-w-0 flex-1 flex-col">
              <Text truncate className="select-text">
                {track.title}
              </Text>
              <Text variant="meta" color="muted" truncate className="select-text">
                {joinParts(track.artist, track.album, track.year)}
              </Text>
            </span>
            <Text variant="meta" color="muted" className="shrink-0">
              {track.codec}
            </Text>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AllClear() {
  return (
    <EmptyState
      title="Nothing left here"
      description="This one has cleared since the last look"
      action={<Button onClick={goBack}>Back</Button>}
    />
  );
}

function TrackDetail({ check }: Props) {
  const tracks = useQuery(reportTracksQuery(check.id));

  if (tracks.isPending) return <ListSkeleton kind="rows" />;
  if (tracks.isError) return <ErrorState error={tracks.error} onRetry={() => void tracks.refetch()} />;
  if (tracks.data.length === 0) return <AllClear />;
  return <CheckTracks check={check} tracks={tracks.data} />;
}

/** A file a scan couldn't use has no track to list, only a path and a reason. Bad tags have their own check. */
function IssueDetail({ check: { name, description } }: Props) {
  const issues = useQuery(issuesQuery);

  if (issues.isPending) return <ListSkeleton kind="rows" />;
  if (issues.isError) return <ErrorState error={issues.error} onRetry={() => void issues.refetch()} />;
  const shown = issues.data.filter(({ kind }) => kind !== 'bad_tags');
  if (shown.length === 0) return <AllClear />;

  return (
    <div className="content-in flex min-h-0 flex-1 flex-col overflow-y-auto pb-section">
      <DetailHeader title={name} meta={formatPlural(shown.length, 'file')}>
        <Text as="p" color="muted">
          {description}
        </Text>
      </DetailHeader>
      <ul className="flex flex-col gap-3 px-gutter">
        {shown.map(({ relPath, kind, message }) => (
          <li key={`${kind}:${relPath}`} className="flex flex-col">
            <Text className="wrap-anywhere select-text">{relPath.replaceAll('/', '\\')}</Text>
            <Text variant="meta" color="muted" className="wrap-anywhere select-text">
              {message}
            </Text>
          </li>
        ))}
      </ul>
    </div>
  );
}

type Props = {
  check: ReportCheck;
};

export function CheckDetail({ check }: Props) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 pt-2">
        <Button variant="ghost" size="sm" onClick={closeReportCheck}>
          <ArrowLeft aria-hidden />
          Library report
        </Button>
      </div>
      {check.shows === 'issues' ? <IssueDetail check={check} /> : <TrackDetail check={check} />}
    </div>
  );
}
