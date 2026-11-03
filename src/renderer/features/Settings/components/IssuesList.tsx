import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { ScanIssue, ScanIssueKind } from '@shared/domain';
import { Button } from '@/components/ui/Button';
import { Collapse } from '@/components/ui/Collapse';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { groupIssues } from '@/features/Settings/utils/groupIssues';
import { formatPlural } from '@/lib/format';
import { issuesQuery } from '@/lib/libraryQueries';

const SHOWN_AT_FIRST = 10;

const KIND_WORDS: Record<ScanIssueKind, string> = {
  unreadable: "Couldn't be opened",
  bad_tags: 'Missing or broken tags',
  bad_cue: 'Broken CUE sheet',
  cue_file_missing: "CUE sheet points to an audio file that isn't there",
  no_audio: 'No audio in the file',
};

/** Stored with forward slashes so a copy works anywhere. This screen shows Windows paths, and this is one. */
function windowsPath(relPath: string): string {
  return relPath.replaceAll('/', '\\');
}

type IssueProps = {
  issue: ScanIssue;
};

function Issue({ issue: { relPath, kind, message } }: IssueProps) {
  return (
    <li className="flex flex-col [contain-intrinsic-size:auto_3em] [content-visibility:auto]">
      <Text className="wrap-anywhere select-text">{windowsPath(relPath)}</Text>
      <Text variant="meta" color="muted" className="wrap-anywhere select-text">
        {KIND_WORDS[kind]}: {message}
      </Text>
    </li>
  );
}

type FilesProps = {
  issues: ScanIssue[];
};

/** Can run to thousands in a bad library, so most of them wait to be asked for. */
function IssueFiles({ issues }: FilesProps) {
  const [showAll, setShowAll] = useState(false);
  const rest = issues.slice(SHOWN_AT_FIRST);

  return (
    <div className="flex flex-col">
      <ul className="flex flex-col gap-3">
        {issues.slice(0, SHOWN_AT_FIRST).map((issue) => (
          <Issue key={`${issue.kind}:${issue.relPath}`} issue={issue} />
        ))}
      </ul>
      <Collapse open={showAll}>
        <ul className="flex flex-col gap-3 pt-3">
          {rest.map((issue) => (
            <Issue key={`${issue.kind}:${issue.relPath}`} issue={issue} />
          ))}
        </ul>
      </Collapse>
      <Collapse open={!showAll && rest.length > 0}>
        <div className="flex pt-3">
          <Button variant="outline" size="sm" onClick={() => setShowAll(true)}>
            Show {formatPlural(rest.length, 'more file', 'more files')}
          </Button>
        </div>
      </Collapse>
    </div>
  );
}

type Props = {
  /** A scan has finished and read something, so a clean report says something. */
  hasReadFiles: boolean;
};

/** Most files share their reason, so it's one line per reason until the files themselves are asked for. */
export function IssuesList({ hasReadFiles }: Props) {
  const issues = useQuery(issuesQuery);
  const [showFiles, setShowFiles] = useState(false);

  if (issues.isPending) return <Skeleton className="h-10 w-full animate-appear-late" />;
  if (issues.isError) return <ErrorState error={issues.error} onRetry={() => void issues.refetch()} />;
  if (issues.data.length === 0) {
    if (!hasReadFiles) return null;
    return (
      <Text as="p" variant="meta" color="muted">
        Every file read cleanly
      </Text>
    );
  }

  const groups = groupIssues(issues.data);

  return (
    <div data-testid="scan-issues" className="flex flex-col gap-3 pt-2">
      <Text as="h3" variant="label" color="muted">
        {formatPlural(issues.data.length, 'file')} the rescan had trouble with
      </Text>
      <Text as="p" variant="meta" color="muted">
        Tags are the song details stored inside a file: title, artist, album, year. Where they're missing, the app makes
        do, such as using the file name for a title. These still play. Fix them in foobar2000, then Rescan
      </Text>
      <ul className="flex flex-col gap-1">
        {groups.map(({ kind, message, count }) => (
          <li key={`${kind}:${message}`}>
            <Text className="wrap-anywhere select-text">
              {/* The heading has already said how many, when there's only the one reason. */}
              {groups.length > 1 ? `${formatPlural(count, 'file')} · ` : null}
              {KIND_WORDS[kind]}: {message}
            </Text>
          </li>
        ))}
      </ul>
      <Button
        variant="outline"
        size="sm"
        aria-expanded={showFiles}
        onClick={() => setShowFiles(!showFiles)}
        className="self-start"
      >
        {showFiles ? 'Hide the files' : 'Show the files'}
      </Button>
      <Collapse open={showFiles} className="-mt-3">
        <div className="pt-3">
          <IssueFiles issues={issues.data} />
        </div>
      </Collapse>
    </div>
  );
}
