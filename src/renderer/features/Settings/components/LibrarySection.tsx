import { useQuery } from '@tanstack/react-query';
import type { StorageInfo } from '@shared/domain';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { ModalSection } from '@/components/ui/ModalSection';
import { Text } from '@/components/ui/Text';
import { IssuesList } from '@/features/Settings/components/IssuesList';
import { RevealButton } from '@/features/Settings/components/RevealButton';
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
    <section aria-label="Library" className="flex flex-col">
      <ModalSection title="Folder">
        <Field
          label="Path"
          action={storage.libraryFolder === null ? null : <RevealButton target="library" what="the library folder" />}
        >
          {storage.libraryFolder ?? 'None chosen'}
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="md" onClick={() => chooseFolder.mutate()}>
            Change folder
          </Button>
          <Button variant="outline" size="md" loading={rescan.isPending || isScanning} onClick={() => rescan.mutate()}>
            Rescan
          </Button>
        </div>
      </ModalSection>

      <ModalSection title="Scan">
        <Field label="Last scan">
          {storage.lastScanAt === null ? 'Not scanned yet' : formatDateTime(storage.lastScanAt)}
        </Field>
        {report === null ? null : (
          <Text as="p" variant="meta" color="muted" data-testid="scan-report">
            {reportWords(report)}, took {formatSpan(report.durationMs)}
          </Text>
        )}

        <IssuesList hasReadFiles={storage.lastScanAt !== null && tracks + missing > 0} />
      </ModalSection>
    </section>
  );
}
