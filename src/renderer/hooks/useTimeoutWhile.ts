import { useEffect, useRef } from 'react';

/** Calls back once `ms` after `isOn` turns true, unless it turns false first. */
export function useTimeoutWhile(isOn: boolean, ms: number, onTimeout: () => void): void {
  const latest = useRef(onTimeout);
  useEffect(() => {
    latest.current = onTimeout;
  });

  useEffect(() => {
    if (!isOn) return;
    const timer = setTimeout(() => latest.current(), ms);
    return () => clearTimeout(timer);
  }, [isOn, ms]);
}
