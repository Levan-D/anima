import { useQuery } from '@tanstack/react-query';
import { useRef } from 'react';
import type { MoodDraft } from '@shared/stations';
import { ErrorState } from '@/components/ui/ErrorState';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';
import { useSaveThenClose } from '@/hooks/useSaveThenClose';
import { deleteMood, moodQuery, saveMood } from '@/lib/moodQueries';
import { draftOf, NEW_DRAFT } from '@/features/Radio/utils/moodDraft';
import { MoodTunerForm } from './MoodTunerForm';

type Props = {
  /** Null for a new one. */
  stationId: number | null;
  onClose: () => void;
};

function Loading() {
  return (
    <div aria-hidden className="flex flex-col gap-gap p-section">
      <Skeleton className="h-tap w-full rounded-md" />
      <Skeleton className="h-40 w-full rounded-md" />
      <Skeleton className="h-40 w-full rounded-md" />
    </div>
  );
}

/** Over Tune it, mounted only while it's open, so each opening starts from what's saved. */
export function MoodTuner({ stationId, onClose }: Props) {
  const saved = useQuery({ ...moodQuery(stationId ?? 0), enabled: stationId !== null });
  const { isOpen, setIsOpen, isSaving, problem, clearProblem, save } = useSaveThenClose(
    (draft: MoodDraft) => saveMood(stationId, draft),
    onClose,
  );
  const title = stationId === null ? 'New mood' : 'Tune mood';
  const nameField = useRef<HTMLInputElement>(null);

  function body() {
    const form = (initial: typeof NEW_DRAFT) => (
      <MoodTunerForm
        stationId={stationId}
        initial={initial}
        nameField={nameField}
        isSaving={isSaving}
        problem={problem}
        onChange={clearProblem}
        onSave={save}
        onCancel={() => setIsOpen(false)}
        onDelete={
          stationId === null
            ? null
            : () => {
                deleteMood(stationId);
                setIsOpen(false);
              }
        }
      />
    );
    if (stationId === null) return form(NEW_DRAFT);
    if (saved.isPending) return <Loading />;
    if (saved.isError) return <ErrorState error={saved.error} onRetry={() => void saved.refetch()} />;
    return form(draftOf(saved.data));
  }

  return (
    <Modal
      open={isOpen}
      onOpenChange={setIsOpen}
      title={title}
      closeLabel={`Close ${title}`}
      size="tall"
      onOpenAutoFocus={(event) => {
        // A new one starts with its name. An old one has one, and Radix's first stop is fine.
        if (stationId !== null) return;
        event.preventDefault();
        nameField.current?.focus();
      }}
    >
      {body()}
    </Modal>
  );
}
