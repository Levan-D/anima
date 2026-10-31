import { useEffect, useRef, useState } from 'react';
import type { EqSettings } from '@shared/domain';
import { setEq } from '@/lib/playerActions';
import { usePlayer } from '@/lib/playerStore';

// Often enough to hear it follow the finger. Main only passes on the latest of these anyway.
const SEND_EVERY_MS = 50;

/**
 * The EQ as main says it is, except while it's being changed: a drag can outrun the round trip to main, and the next step
 * has to start from the last one.
 */
export function useEqDraft() {
  const stored = usePlayer((state) => state.eq);
  const [draft, setDraft] = useState<EqSettings | null>(null);
  const unsent = useRef<EqSettings | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(0);

  function finishIfQuiet(): void {
    if (unsent.current === null && timer.current === null && inFlight.current === 0) setDraft(null);
  }

  function sendUnsent(): void {
    const next = unsent.current;
    if (next === null) return;
    unsent.current = null;
    inFlight.current++;
    void setEq(next).finally(() => {
      inFlight.current--;
      finishIfQuiet();
    });
  }

  function change(next: EqSettings): void {
    setDraft(next);
    unsent.current = next;
    if (timer.current !== null) return;
    sendUnsent();
    timer.current = setTimeout(() => {
      timer.current = null;
      sendUnsent();
      finishIfQuiet();
    }, SEND_EVERY_MS);
  }

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      sendUnsentOnLeaving(unsent);
    },
    [],
  );

  return { eq: draft ?? stored, change };
}

/** Closing the panel in the middle of a drag still leaves the EQ where the drag had got to. */
function sendUnsentOnLeaving(unsent: { current: EqSettings | null }): void {
  if (unsent.current !== null) void setEq(unsent.current);
  unsent.current = null;
}
