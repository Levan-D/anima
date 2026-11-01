import { useEffect, useRef, useState } from 'react';
import type { EqSettings } from '@shared/domain';
import { call } from '@/lib/api';
import { showToast } from '@/lib/toastStore';

/**
 * Hearing the EQ's off side while something is held down. Main takes over the EQ for that long, so the screen holds on to what
 * was there, and goes back to following main only once main has it back: the reply comes after main's state has gone out.
 */
export function useEqCompare(isOpen: boolean, eq: EqSettings, sampleRate: number) {
  const [frozen, setFrozen] = useState<EqSettings | null>(null);
  const isHeld = useRef(false);
  const latest = useRef({ eq, sampleRate });
  useEffect(() => {
    latest.current = { eq, sampleRate };
  });

  function start(): void {
    if (isHeld.current) return;
    isHeld.current = true;
    setFrozen(latest.current.eq);
    void call('headphones.compare', { on: true, sampleRate: latest.current.sampleRate }).then((result) => {
      if (result.ok) return;
      isHeld.current = false;
      setFrozen(null);
      showToast({ message: result.error.message, level: 'error' });
    });
  }

  function stop(): void {
    if (!isHeld.current) return;
    isHeld.current = false;
    void call('headphones.compare', { on: false, sampleRate: latest.current.sampleRate }).then(() => setFrozen(null));
  }

  const stopRef = useRef(stop);
  useEffect(() => {
    stopRef.current = stop;
  });

  // Letting go can happen anywhere, or not at all: the window loses focus, or the modal goes.
  useEffect(() => {
    const onLeave = () => stopRef.current();
    window.addEventListener('blur', onLeave);
    return () => {
      window.removeEventListener('blur', onLeave);
      stopRef.current();
    };
  }, []);

  useEffect(() => {
    if (!isOpen) stopRef.current();
  }, [isOpen]);

  return { frozen, isComparing: frozen !== null, start, stop };
}

export type EqCompare = ReturnType<typeof useEqCompare>;
