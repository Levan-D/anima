/** In seconds, for `motion`, read from the token, which is 0 under reduced motion. The build rewrites `300ms` to `.3s`. */
export function motionDuration(token: '--dur-fast' | '--dur-mid' | '--dur-slow' | '--dur-loop'): number {
  const text = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  const amount = Number.parseFloat(text);
  if (!Number.isFinite(amount)) return 0;
  return text.endsWith('ms') ? amount / 1000 : amount;
}
