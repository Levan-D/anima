import { useEffect, useState } from 'react';

const QUIET_MS = 200;

/** True from when `value` changes until it has held still for a moment, so typing is one change and not many. */
export function useIsSettling(value: string): boolean {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), QUIET_MS);
    return () => clearTimeout(timer);
  }, [value]);

  return value !== settled;
}
