/* A mood station being tuned, before it's saved. Pure. */

import type { MoodDraft, MoodExample } from '@shared/stations';

export type CheckAnswer = 'yes' | 'no' | 'skip';
export type CheckAnswers = Readonly<Record<number, { answer: CheckAnswer; key: string; label: string }>>;

export type TunerDraft = MoodDraft & {
  /** Songs a check round was told to skip, not to be asked about again while tuning. */
  skipped: readonly number[];
  /** This round's answers, by track id. They count once the next round is asked for, or on save. */
  answers: CheckAnswers;
};

export const NEW_DRAFT: TunerDraft = {
  name: '',
  examples: [],
  rules: { instrumental: true, calm: true, littleSinging: true },
  genre: null,
  decade: null,
  skipped: [],
  answers: {},
};

export function draftOf(station: MoodDraft): TunerDraft {
  const { name, examples, rules, genre, decade } = station;
  return { name, examples, rules, genre, decade, skipped: [], answers: {} };
}

const isSame = (a: MoodExample, b: Pick<MoodExample, 'kind' | 'key'>) => a.kind === b.kind && a.key === b.key;

/** Saying it again the other way changes it where it stands, since its place settles a song two examples name. */
export function withExample(examples: readonly MoodExample[], example: MoodExample): MoodExample[] {
  return examples.some((other) => isSame(other, example))
    ? examples.map((other) => (isSame(other, example) ? example : other))
    : [...examples, example];
}

export function withoutExample(examples: readonly MoodExample[], gone: MoodExample): MoodExample[] {
  return examples.filter((other) => !isSame(other, gone));
}

export function exampleFor(
  examples: readonly MoodExample[],
  kind: MoodExample['kind'],
  key: string,
): MoodExample | null {
  return examples.find((other) => isSame(other, { kind, key })) ?? null;
}

/** The round's answers, made examples and skips. */
export function withAnswers(draft: TunerDraft): TunerDraft {
  let { examples } = draft;
  const skipped = [...draft.skipped];
  for (const [id, { answer, key, label }] of Object.entries(draft.answers)) {
    if (answer === 'skip') skipped.push(Number(id));
    else examples = withExample(examples, { kind: 'track', key, label, isYes: answer === 'yes', source: 'check' });
  }
  return { ...draft, examples, skipped, answers: {} };
}

export function savedDraft({ name, examples, rules, genre, decade }: TunerDraft): MoodDraft {
  return { name: name.trim(), examples, rules, genre, decade };
}

export function hasYes(examples: readonly MoodExample[]): boolean {
  return examples.some(({ isYes }) => isYes);
}
