import { useSettled } from '@/hooks/useSettled';

const MIN_SEARCH_LETTERS = 2;

/**
 * What a picker searches for: the words once typing pauses, so results don't flicker through every letter, and nothing
 * under two letters, where nearly everything matches. Going under two letters clears it at once.
 */
export function useSearchText(value: string): string {
  const text = value.trim();
  const settled = useSettled(text);
  return text.length < MIN_SEARCH_LETTERS || settled.length < MIN_SEARCH_LETTERS ? '' : settled;
}
