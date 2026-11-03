import type { DatasetState } from '@shared/domain';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Collapse } from '@/components/ui/Collapse';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Divider } from '@/components/ui/Divider';
import { ProgressLine } from '@/components/ui/ProgressLine';
import { Swap } from '@/components/ui/Swap';
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
  /** Where it asks, or null when it all stays on this PC. */
  source: string | null;
  /** Said before it starts, for one that takes long or goes online. Null starts it straight away. */
  confirmWords: string | null;
};

function progressWords({ done, failed, total }: NonNullable<DatasetState['progress']>): string {
  if (total === 0) return 'Starting';
  return joinParts(
    `${formatCount(done + failed)} of ${formatCount(total)}`,
    failed > 0 ? `${formatCount(failed)} skipped` : null,
  );
}

/** One thing the app can bring up to date: where it stands, when it last ran, and the button for it. */
export function UpdateRow({ dataset, title, description, doneWords, missingWords, source, confirmWords }: Props) {
  const { id, done, missing, detail, lastRunAt, progress, problem, note } = dataset;
  const [isAsking, setIsAsking] = useState(false);
  const isRunning = progress !== null;
  const counts = joinParts(
    `${formatCount(done)} ${doneWords}`,
    missing > 0 ? `${formatCount(missing)} ${missingWords}` : null,
  );
  const lastRun = lastRunAt === null ? 'Never run' : `Last run ${formatDateTime(lastRunAt)}`;

  return (
    <>
      <Divider />
      <section aria-label={title} data-testid={`update-${id}`} className="flex flex-col py-block">
        <div className="flex flex-wrap items-center justify-between gap-x-gap gap-y-2">
          <div className="flex min-w-0 flex-[1_1_20em] flex-col">
            <Text as="h3" variant="lead">
              {title}
            </Text>
            <Text as="p" variant="meta" color="muted">
              {description}
            </Text>
            <Text as="p" variant="meta" color="accent">
              {source === null ? 'Stays on this PC' : `Asks ${source}`}
            </Text>
            <Text as="p" variant="meta" color="muted" tabular>
              {detail ?? counts}
            </Text>
            <Text as="p" variant="meta" color="muted" tabular>
              {isRunning ? progressWords(progress) : lastRun}
            </Text>
          </div>
          <Swap id={isRunning ? 'running' : 'idle'} className="shrink-0">
            {isRunning ? (
              <Button variant="outline" size="md" onClick={() => cancelDataset(id)}>
                Cancel
              </Button>
            ) : (
              <Button
                variant="outline"
                size="md"
                disabled={problem !== null}
                onClick={() => (confirmWords === null ? updateDataset(id) : setIsAsking(true))}
              >
                Update
              </Button>
            )}
          </Swap>
        </div>
        <Collapse open={isRunning}>
          {isRunning ? (
            <ProgressLine
              value={progress.total === 0 ? null : (progress.done + progress.failed) / progress.total}
              label={title}
              className="mt-2"
            />
          ) : null}
        </Collapse>
        <Collapse open={problem !== null}>
          <Text as="p" variant="meta" color="danger" className="pt-2">
            {problem}
          </Text>
        </Collapse>
        <Collapse open={note !== null && !isRunning}>
          <Text as="p" variant="meta" color="muted" className="pt-2">
            {note}
          </Text>
        </Collapse>
      </section>
      {isAsking && confirmWords !== null ? (
        <ConfirmDialog
          title={`Update ${title}?`}
          description={confirmWords}
          confirmLabel="Update"
          isDanger={false}
          onConfirm={() => updateDataset(id)}
          onClose={() => setIsAsking(false)}
        />
      ) : null}
    </>
  );
}
