import { useEffect, useState } from 'react';
import type { MoodGrade } from '@shared/stations';
import { on } from '@/lib/api';
import { gradeMood, type MoodSettings } from '@/lib/moodQueries';

export type GradeState =
  | { phase: 'grading'; done: number; total: number }
  | { phase: 'done'; grade: MoodGrade }
  | { phase: 'failed'; message: string };

type Held = GradeState & { examplesKey: string };

/** Only the examples change a grade: rules and filters come after it. */
function examplesKey({ examples }: MoodSettings): string {
  return JSON.stringify(examples.map(({ kind, key, isYes }) => [kind, key, isYes]));
}

/**
 * Hiding each example in turn, with how far it has got. What it says belongs to the examples it was started for, and goes
 * once they change; a grade a newer try took over from just stops.
 */
export function useMoodGrade(stationId: number | null, settings: MoodSettings) {
  const [held, setHeld] = useState<Held | null>(null);
  const key = examplesKey(settings);

  useEffect(
    () =>
      on('moods.grading', ({ done, total }) =>
        setHeld((current) => (current?.phase === 'grading' ? { ...current, done, total } : current)),
      ),
    [],
  );

  function start(): void {
    setHeld({ phase: 'grading', done: 0, total: 0, examplesKey: key });
    void gradeMood(stationId, settings).then((result) =>
      setHeld((current) => {
        if (current?.examplesKey !== key) return current;
        if (result.ok) return { phase: 'done', grade: result.value, examplesKey: key };
        return result.error.code === 'superseded'
          ? null
          : { phase: 'failed', message: result.error.message, examplesKey: key };
      }),
    );
  }

  return { state: held?.examplesKey === key ? held : null, start };
}

export type MoodGrading = ReturnType<typeof useMoodGrade>;
