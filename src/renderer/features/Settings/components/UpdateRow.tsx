import type { DatasetState } from '@shared/domain';
import { Button } from '@/components/ui/Button';
import { Divider } from '@/components/ui/Divider';
import { ProgressLine } from '@/components/ui/ProgressLine';
import { Text } from '@/components/ui/Text';
import { formatCount, formatDateTime, joinParts } from '@/lib/format';
import { cancelDataset, updateDataset } from '@/lib/dataActions';

type Props = {
  dataset: DatasetState;
  title: string;
  /** What it collects, and what leaves the machine if anything does. */
  description: string;
  /** What counts as done and as missing, such as "tracks scanned" and "missing files". */
  doneWords: string;
  missingWords: string;
};

function progressWords({ done, failed, total }: NonNullable<DatasetState['progress']>): string {
  if (total === 0) return 'Starting';
  return joinParts(
    `${formatCount(done + failed)} of ${formatCount(total)}`,
    failed > 0 ? `${formatCount(failed)} skipped` : null,
  );
}

/** One thing the app can bring up to date: where it stands, when it last ran, and the button for it. */
export function UpdateRow({ dataset, title, description, doneWords, missingWords }: Props) {
  const { id, done, missing, detail, lastRunAt, progress, problem, note } = dataset;
  const isRunning = progress !== null;
  const counts = joinParts(
    `${formatCount(done)} ${doneWords}`,
    missing > 0 ? `${formatCount(missing)} ${missingWords}` : null,
  );
  const lastRun = lastRunAt === null ? 'Never run' : `Last run ${formatDateTime(lastRunAt)}`;

  return (
    <>
      <Divider />
      <section aria-label={title} data-testid={`update-${id}`} className="flex flex-col gap-2 py-section">
        <div className="flex flex-wrap items-center justify-between gap-x-gap gap-y-2">
          <div className="flex min-w-0 flex-[1_1_20em] flex-col">
            <Text as="h3" variant="lead">
              {title}
            </Text>
            <Text as="p" variant="meta" color="muted">
              {description}
            </Text>
            <Text as="p" variant="meta" color="muted" tabular>
              {detail ?? counts}
            </Text>
            <Text as="p" variant="meta" color="muted" tabular>
              {isRunning ? progressWords(progress) : lastRun}
            </Text>
          </div>
          {isRunning ? (
            <Button variant="outline" size="md" onClick={() => cancelDataset(id)}>
              Cancel
            </Button>
          ) : (
            <Button variant="outline" size="md" disabled={problem !== null} onClick={() => updateDataset(id)}>
              Update
            </Button>
          )}
        </div>
        {isRunning ? (
          <ProgressLine
            value={progress.total === 0 ? null : (progress.done + progress.failed) / progress.total}
            label={title}
          />
        ) : null}
        {problem === null ? null : (
          <Text as="p" variant="meta" color="danger">
            {problem}
          </Text>
        )}
        {note === null || isRunning ? null : (
          <Text as="p" variant="meta" color="muted">
            {note}
          </Text>
        )}
      </section>
    </>
  );
}
