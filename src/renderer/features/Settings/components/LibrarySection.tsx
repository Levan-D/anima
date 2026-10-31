import { useQuery } from '@tanstack/react-query';
import type { StorageInfo } from '@shared/domain';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { Field } from '@/features/Settings/components/Field';
import { IssuesList } from '@/features/Settings/components/IssuesList';
import { RevealButton } from '@/features/Settings/components/RevealButton';
import { Section } from '@/features/Settings/components/Section';
import { reportWords } from '@/features/Settings/utils/reportWords';
import { formatDateTime, formatSpan } from '@/lib/format';
import { useChooseFolder, useRescan } from '@/lib/libraryActions';
import { scanQuery, useIsScanning } from '@/lib/libraryQueries';

type Props = {
  storage: StorageInfo;
};

export function LibrarySection({ storage }: Props) {
  const { data: report = null } = useQuery({ ...scanQuery, select: ({ lastReport }) => lastReport });
  const isScanning = useIsScanning();
  const rescan = useRescan();
  const chooseFolder = useChooseFolder();
  const { tracks, missing } = storage.counts;

  return (
    <Section title="Library" hideTitle>
      <Field
        label="Folder"
        action={storage.libraryFolder === null ? null : <RevealButton target="library" what="the library folder" />}
      >
        {storage.libraryFolder ?? 'None chosen'}
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => chooseFolder.mutate()}>Change folder</Button>
        <Button loading={rescan.isPending || isScanning} onClick={() => rescan.mutate()}>
          Rescan
        </Button>
      </div>

      <Field label="Last scan">
        {storage.lastScanAt === null ? 'Not scanned yet' : formatDateTime(storage.lastScanAt)}
      </Field>
      {report === null ? null : (
        <Text as="p" variant="meta" color="muted" data-testid="scan-report">
          {reportWords(report)}, took {formatSpan(report.durationMs)}
        </Text>
      )}

      <IssuesList hasReadFiles={storage.lastScanAt !== null && tracks + missing > 0} />
    </Section>
  );
}
