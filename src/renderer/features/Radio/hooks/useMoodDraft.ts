import { useState } from 'react';
import type { MoodExample, MoodRule } from '@shared/stations';
import {
  withAnswers,
  withExample,
  withoutExample,
  type CheckAnswer,
  type TunerDraft,
} from '@/features/Radio/utils/moodDraft';

/** What the tuner changes, held until it's saved or dropped. */
export function useMoodDraft(initial: TunerDraft) {
  const [draft, setDraft] = useState(initial);

  return {
    draft,
    setName: (name: string) => setDraft((current) => ({ ...current, name })),
    addExample: (example: MoodExample) =>
      setDraft((current) => ({ ...current, examples: withExample(current.examples, example) })),
    removeExample: (example: MoodExample) =>
      setDraft((current) => ({ ...current, examples: withoutExample(current.examples, example) })),
    setRule: (rule: MoodRule, isOn: boolean) =>
      setDraft((current) => ({ ...current, rules: { ...current.rules, [rule]: isOn } })),
    setGenre: (genre: string | null) => setDraft((current) => ({ ...current, genre })),
    setDecade: (decade: number | null) => setDraft((current) => ({ ...current, decade })),
    /** The same answer again takes it back. */
    answer: (trackId: number, key: string, label: string, answer: CheckAnswer) =>
      setDraft((current) => {
        const { [trackId]: before, ...others } = current.answers;
        const answers = before?.answer === answer ? others : { ...others, [trackId]: { answer, key, label } };
        return { ...current, answers };
      }),
    nextRound: () => setDraft(withAnswers),
  };
}

export type MoodDraftControls = ReturnType<typeof useMoodDraft>;
