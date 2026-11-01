import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import type { ReportCheck, Track } from '@shared/domain';
import { DetailHeader } from '@/components/music/DetailHeader';
import type { MusicSection } from '@/components/music/listItems';
import { ListSkeleton } from '@/components/music/ListSkeleton';
import { MusicList } from '@/components/music/MusicList';
import { PlayAllButton } from '@/components/music/PlayAllButton';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Text } from '@/components/ui/Text';
import { formatPlural } from '@/lib/format';
import { issuesQuery, reportTracksQuery } from '@/lib/libraryQueries';
import { goBack, reportListKey } from '@/lib/navigation';
import { playTracks } from '@/lib/playerActions';

type TracksProps = {
  check: ReportCheck;
  tracks: Track[];
};

function CheckTracks({ check: { id, name, description }, tracks }: TracksProps) {
  const sections = useMemo((): MusicSection[] => [{ kind: 'tracks', tracks, numbered: false }], [tracks]);
  const play = useCallback((track: Track) => playTracks(tracks, track), [tracks]);

  return (
    <MusicList
      label={name}
      sections={sections}
      memoryKey={reportListKey(id)}
      onPlayTrack={play}
      isUnderIsland
      header={
        <DetailHeader
          title={name}
          meta={formatPlural(tracks.length, 'track')}
          action={<PlayAllButton tracks={tracks} />}
        >
          <Text as="p" color="muted">
            {description}
          </Text>
        </DetailHeader>
      }
    />
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
    <div className="content-in flex min-h-0 flex-1 flex-col overflow-y-auto pb-island-clear">
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
  return check.shows === 'issues' ? <IssueDetail check={check} /> : <TrackDetail check={check} />;
}
