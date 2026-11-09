import { describe, expect, it } from 'vitest';
import type { MoodExample } from '@shared/stations';
import { hasYes, NEW_DRAFT, savedDraft, withAnswers, withExample, withoutExample, type TunerDraft } from './moodDraft';

const example = (key: string, isYes: boolean, kind: MoodExample['kind'] = 'artist'): MoodExample => ({
  kind,
  key,
  label: key,
  isYes,
  source: 'picked',
});

describe('a draft’s examples', () => {
  it('adds an example at the end, and changes one said again where it stands', () => {
    const examples = withExample(withExample([], example('a', true)), example('b', false));
    expect(withExample(examples, example('a', false))).toEqual([example('a', false), example('b', false)]);
    expect(withExample(examples, example('a', true, 'album'))).toHaveLength(3);
    expect(withoutExample(examples, example('a', false))).toEqual([example('b', false)]);
  });

  it('makes a round’s answers songs that belong or don’t, and its skips songs not to ask about again', () => {
    const draft: TunerDraft = {
      ...NEW_DRAFT,
      examples: [example('a', true)],
      skipped: [1],
      answers: {
        5: { answer: 'yes', key: 'x\tone', label: 'One – X' },
        6: { answer: 'no', key: 'x\ttwo', label: 'Two – X' },
        7: { answer: 'skip', key: 'x\tthree', label: 'Three – X' },
      },
    };
    const next = withAnswers(draft);
    expect(next.examples.map(({ kind, key, isYes, source }) => [kind, key, isYes, source])).toEqual([
      ['artist', 'a', true, 'picked'],
      ['track', 'x\tone', true, 'check'],
      ['track', 'x\ttwo', false, 'check'],
    ]);
    expect(next.skipped).toEqual([1, 7]);
    expect(next.answers).toEqual({});
  });

  it('saves the name trimmed, without what only the tuner needs', () => {
    expect(savedDraft({ ...NEW_DRAFT, name: '  Study ', skipped: [3] })).toEqual({
      name: 'Study',
      examples: [],
      rules: NEW_DRAFT.rules,
      genre: null,
      decade: null,
    });
    expect(hasYes([example('a', false)])).toBe(false);
  });
});
