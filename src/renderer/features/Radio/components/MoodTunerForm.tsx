import { useQuery } from '@tanstack/react-query';
import type { RefObject, SyntheticEvent } from 'react';
import type { MoodDraft } from '@shared/stations';
import { MOOD_NAME_MAX } from '@shared/stations';
import { Button } from '@/components/ui/Button';
import { ConfirmButton } from '@/components/ui/ConfirmButton';
import { Divider } from '@/components/ui/Divider';
import { Input } from '@/components/ui/Input';
import { ModalSection } from '@/components/ui/ModalSection';
import { Text } from '@/components/ui/Text';
import { moodTryQuery } from '@/lib/moodQueries';
import { useMoodDraft } from '@/features/Radio/hooks/useMoodDraft';
import { useMoodGrade } from '@/features/Radio/hooks/useMoodGrade';
import { hasYes, savedDraft, withAnswers, type TunerDraft } from '@/features/Radio/utils/moodDraft';
import { MoodCheckRound } from './MoodCheckRound';
import { MoodExamples } from './MoodExamples';
import { MoodPlays } from './MoodPlays';

type Props = {
  stationId: number | null;
  initial: TunerDraft;
  isSaving: boolean;
  /** What went wrong with the last save. */
  problem: string | null;
  onChange: () => void;
  onSave: (draft: MoodDraft) => void;
  onCancel: () => void;
  /** Null for one that isn't saved yet. */
  onDelete: (() => void) | null;
  /** For the modal to put focus in when a new one opens. */
  nameField: RefObject<HTMLInputElement | null>;
};

/** Name, examples, a check round and what it plays, in that order, with the footer always in view. */
export function MoodTunerForm({
  stationId,
  initial,
  isSaving,
  problem,
  onChange,
  onSave,
  onCancel,
  onDelete,
  nameField,
}: Props) {
  const controls = useMoodDraft(initial);
  const { draft } = controls;
  const settings = { examples: draft.examples, rules: draft.rules, genre: draft.genre, decade: draft.decade };
  const canTry = hasYes(draft.examples);
  const tried = useQuery({
    ...moodTryQuery({ stationId, draft: settings, skipped: [...draft.skipped] }),
    enabled: canTry,
  });
  const grading = useMoodGrade(stationId, settings);
  const committed = withAnswers(draft);
  const isBlank = draft.name.trim() === '';
  const canSave = !isBlank && hasYes(committed.examples);

  let waitingFor: string | null = null;
  if (isBlank) waitingFor = 'Give it a name';
  else if (!hasYes(committed.examples)) waitingFor = 'Add something that sounds like it';

  function submit(event: SyntheticEvent): void {
    event.preventDefault();
    if (canSave) onSave(savedDraft(committed));
  }

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <div
        data-testid="mood-tuner"
        className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-section"
      >
        <ModalSection title="Name">
          <Input
            ref={nameField}
            aria-label="Mood name"
            className="h-tap"
            placeholder="Study, workout, a quiet evening"
            autoComplete="off"
            maxLength={MOOD_NAME_MAX}
            value={draft.name}
            onChange={(event) => {
              controls.setName(event.target.value);
              onChange();
            }}
          />
        </ModalSection>
        <ModalSection title="Sounds like">
          <MoodExamples examples={draft.examples} onAdd={controls.addExample} onRemove={controls.removeExample} />
        </ModalSection>
        <ModalSection title="Check">
          <MoodCheckRound
            tried={tried}
            canTry={canTry}
            answers={draft.answers}
            onAnswer={controls.answer}
            onNextRound={controls.nextRound}
          />
        </ModalSection>
        <ModalSection title="What plays">
          <MoodPlays
            draft={draft}
            tried={tried}
            canTry={canTry}
            grading={grading}
            onRule={controls.setRule}
            onGenre={controls.setGenre}
            onDecade={controls.setDecade}
          />
        </ModalSection>
      </div>
      <Divider />
      <div className="flex shrink-0 flex-wrap items-center gap-2 p-section">
        {onDelete === null ? null : (
          <ConfirmButton variant="danger" onConfirm={onDelete}>
            Delete
          </ConfirmButton>
        )}
        <div className="min-w-0 flex-1 text-right">
          <Text as="p" variant="meta" color={problem === null ? 'muted' : 'danger'} role="status">
            {problem ?? waitingFor ?? ''}
          </Text>
        </div>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={!canSave} loading={isSaving}>
          {stationId === null ? 'Create' : 'Save'}
        </Button>
      </div>
    </form>
  );
}
