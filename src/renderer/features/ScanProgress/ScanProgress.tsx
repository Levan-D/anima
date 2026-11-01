import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { ScanPhase, ScanState } from '@shared/domain';
import { Button } from '@/components/ui/Button';
import { Collapse } from '@/components/ui/Collapse';
import { ProgressLine } from '@/components/ui/ProgressLine';
import { Text } from '@/components/ui/Text';
import { formatCount, formatPlural } from '@/lib/format';
import { useCancelScan } from '@/lib/libraryActions';
import { scanQuery } from '@/lib/libraryQueries';

const PHASE_WORDS: Record<Exclude<ScanPhase, 'idle'>, string> = {
  walking: 'Looking for music',
  reading: 'Reading tags',
  hashing: 'Checking the audio',
  writing: 'Saving',
  art: 'Preparing album art',
};

function countWords({ phase, filesFound, filesDone }: ScanState): string {
  if (phase === 'walking') return filesFound > 0 ? formatPlural(filesFound, 'file') : '';
  if (filesFound === 0) return '';
  return `${formatCount(filesDone)} of ${formatCount(filesFound)}`;
}

function progressOf({ phase, filesFound, filesDone }: ScanState): number | null {
  return phase === 'walking' || filesFound === 0 ? null : filesDone / filesFound;
}

type ScanLineProps = {
  scan: ScanState;
  phase: Exclude<ScanPhase, 'idle'>;
};

function ScanLine({ scan, phase }: ScanLineProps) {
  const cancel = useCancelScan();
  const [isCancelling, setIsCancelling] = useState(false);
  const words = PHASE_WORDS[phase];
  const count = countWords(scan);

  return (
    <div data-testid="scan-progress" className="flex shrink-0 flex-col">
      <div className="flex items-center justify-between gap-gap pr-1 pl-gutter">
        <Text as="p" variant="meta" color="muted" truncate tabular>
          {count === '' ? words : `${words} · ${count}`}
        </Text>
        <Button
          variant="ghost"
          size="compact"
          loading={isCancelling}
          onClick={() => {
            setIsCancelling(true);
            cancel.mutate();
          }}
        >
          Cancel
        </Button>
      </div>
      {/* Under the words, because straight under the tabs it reads as which tab is active. */}
      <ProgressLine value={progressOf(scan)} label={words} />
    </div>
  );
}

/** Only this re-renders on scan progress. The list below it hears about new music through invalidation instead. */
export function ScanProgress() {
  const { data: scan } = useQuery(scanQuery);

  const phase = scan === undefined || scan.phase === 'idle' ? null : scan.phase;

  return (
    <Collapse open={phase !== null} className="shrink-0">
      {scan !== undefined && phase !== null ? <ScanLine scan={scan} phase={phase} /> : null}
    </Collapse>
  );
}
