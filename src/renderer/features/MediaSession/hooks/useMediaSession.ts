import { useEffect } from 'react';
import { startMediaSession } from '@/features/MediaSession/utils/mediaSession';

export function useMediaSession(): void {
  useEffect(() => startMediaSession(), []);
}
