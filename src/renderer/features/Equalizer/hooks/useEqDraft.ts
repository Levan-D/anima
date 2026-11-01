import { useEffect, useMemo, useRef, useState } from 'react';
import type { EqSettings } from '@shared/domain';
import { setEq } from '@/lib/playerActions';
import { onPlayerChange, playerState, usePlayer } from '@/lib/playerStore';

// Often enough to hear it follow the finger. Main only passes on the latest of these anyway.
const SEND_EVERY_MS = 50;
// A state that never matches, because something else changed the EQ meanwhile, doesn't hold the draft for good.
const GIVE_UP_AFTER_MS = 500;

/**
 * The EQ as main says it is, except while it's being changed: a drag can outrun the round trip to main, and the next step
 * has to start from the last one. The draft stays until main's state has caught up with it. A reply to the command says
 * nothing about that, and letting go on the reply dropped a playing drag back to an older state every few frames.
 */
export function useEqDraft() {
  // A string, because every state from main is a new object: only a real change of EQ should render anything here.
  const storedText = usePlayer((state) => JSON.stringify(state.eq));
  const stored = useMemo(() => JSON.parse(storedText) as EqSettings, [storedText]);
  const [draft, setDraft] = useState<EqSettings | null>(null);
  const held = useRef<EqSettings | null>(null);
  const unsent = useRef<EqSettings | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const giveUp = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(0);

  function isQuiet(): boolean {
    return unsent.current === null && timer.current === null && inFlight.current === 0;
  }

  function dropDraft(): void {
    held.current = null;
    setDraft(null);
  }

  function dropIfCaughtUp(): void {
    if (held.current === null || !isQuiet()) return;
    if (JSON.stringify(held.current) === JSON.stringify(playerState().eq)) dropDraft();
  }

  function armGiveUp(): void {
    if (giveUp.current !== null) clearTimeout(giveUp.current);
    giveUp.current = setTimeout(() => {
      giveUp.current = null;
      if (isQuiet()) dropDraft();
    }, GIVE_UP_AFTER_MS);
  }

  function sendUnsent(): void {
    const next = unsent.current;
    if (next === null) return;
    unsent.current = null;
    inFlight.current++;
    void setEq(next).finally(() => {
      inFlight.current--;
      dropIfCaughtUp();
      armGiveUp();
    });
  }

  function change(next: EqSettings): void {
    held.current = next;
    setDraft(next);
    unsent.current = next;
    if (timer.current !== null) return;
    sendUnsent();
    timer.current = setTimeout(() => {
      timer.current = null;
      sendUnsent();
    }, SEND_EVERY_MS);
  }

  const listener = useRef(dropIfCaughtUp);
  useEffect(() => {
    listener.current = dropIfCaughtUp;
  });

  useEffect(() => onPlayerChange(() => listener.current()), []);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
      if (giveUp.current !== null) clearTimeout(giveUp.current);
      timer.current = null;
      sendUnsentOnLeaving(unsent);
    },
    [],
  );

  return { eq: draft ?? stored, change, latest: () => held.current ?? playerState().eq };
}

/** Closing the panel in the middle of a drag still leaves the EQ where the drag had got to. */
function sendUnsentOnLeaving(unsent: { current: EqSettings | null }): void {
  if (unsent.current !== null) void setEq(unsent.current);
  unsent.current = null;
}
