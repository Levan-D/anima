import { useSettled } from '@/hooks/useSettled';

/** True from when `value` changes until it has held still for a moment. */
export function useIsSettling(value: string): boolean {
  return value !== useSettled(value);
}
