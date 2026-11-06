import { useState } from 'react';

type DurationToken = '--dur-fast' | '--dur-quick' | '--dur-mid' | '--dur-slow' | '--dur-loop';

export const EASE_STANDARD = [0.2, 0, 0, 1] as const;

export function prefersReducedMotion(): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** For `scrollTo` and its kin, which glide unless motion is to be kept down. */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth';
}

/** In seconds, for `motion`, read from the token, which is 0 under reduced motion. The build rewrites `300ms` to `.3s`. */
export function motionDuration(token: DurationToken): number {
  const text = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  const amount = Number.parseFloat(text);
  if (!Number.isFinite(amount)) return 0;
  return text.endsWith('ms') ? amount / 1000 : amount;
}

/** Once per mount, since reading a token makes the browser work out styles. 0 means there's to be no motion at all. */
export function useMotionDuration(token: DurationToken): number {
  const [duration] = useState(() => motionDuration(token));
  return duration;
}
