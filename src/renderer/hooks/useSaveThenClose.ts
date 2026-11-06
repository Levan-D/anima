import { useState } from 'react';
import type { Result } from '@shared/result';
import { useTimeoutWhile } from '@/hooks/useTimeoutWhile';
import { useMotionDuration } from '@/lib/motionTokens';

/**
 * A dialog that saves and closes on success, and stays open with what went wrong otherwise, such as a name that's taken.
 * Whoever mounted it takes it away with `onClose`, once it has had the time to close.
 */
export function useSaveThenClose<Value>(onSave: (value: Value) => Promise<Result<unknown>>, onClose: () => void) {
  const [isOpen, setIsOpen] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useTimeoutWhile(!isOpen, useMotionDuration('--dur-mid') * 1000, onClose);

  function save(value: Value): void {
    if (isSaving) return;
    setIsSaving(true);
    void onSave(value).then((result) => {
      setIsSaving(false);
      if (result.ok) setIsOpen(false);
      else setProblem(result.error.message);
    });
  }

  return { isOpen, setIsOpen, isSaving, problem, clearProblem: () => setProblem(null), save };
}
