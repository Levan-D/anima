import { useMediaSession } from '@/features/MediaSession/hooks/useMediaSession';

/**
 * Mounted in the main window only, which stays alive hidden behind the mini player for this reason. Never register the
 * media keys with globalShortcut: that removes this session, and Windows already routes the keys to it.
 */
export function MediaSession() {
  useMediaSession();
  return null;
}
