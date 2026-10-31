import { MINI_WINDOW_HASH } from '@shared/domain';

export function isMiniWindow(): boolean {
  return location.hash === MINI_WINDOW_HASH;
}
