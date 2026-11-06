import { useEffect, useState } from 'react';

const QUIET_MS = 200;

/** `value` once it has held still for a moment, so typing is one change and not many. */
export function useSettled(value: string): string {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), QUIET_MS);
    return () => clearTimeout(timer);
  }, [value]);

  return settled;
}
