import type { WebFrameMain } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { isAllowedSender } from '@main/system/security';

vi.mock('electron', () => ({ app: {}, session: {} }));
vi.mock('@main/system/logging', () => ({ log: {} }));
vi.mock('@main/system/windows', async () => {
  const { APP_ENTRY_URL } = await import('@main/system/protocolUrls');
  return { rendererUrl: () => APP_ENTRY_URL };
});

const frameOn = (origin: string) => ({ origin }) as WebFrameMain;

describe('isAllowedSender', () => {
  it('allows the renderer', () => {
    expect(isAllowedSender(frameOn('app://bundle'))).toBe(true);
  });

  it('refuses a frame that is already gone', () => {
    expect(isAllowedSender(null)).toBe(false);
  });

  it.each(['https://evil.example', 'file://', 'app://elsewhere', 'art://thumb', 'null', ''])('refuses %j', (origin) => {
    expect(isAllowedSender(frameOn(origin))).toBe(false);
  });
});
