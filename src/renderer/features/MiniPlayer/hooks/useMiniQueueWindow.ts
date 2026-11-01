import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import type { MiniQueueSide } from '@shared/domain';
import { call } from '@/lib/api';
import { motionDuration } from '@/lib/motionTokens';
import { closeQueueSheet, useQueueSheet } from '@/lib/queueSheet';
import { showToast } from '@/lib/toastStore';

/**
 * Whether the queue is open and on which side of the strip, with main growing the window around the strip to match. It
 * grows once the strip has been drawn at the right end, and shrinks once the queue has left.
 */
export function useMiniQueueWindow(): { isOpen: boolean; side: MiniQueueSide } {
  const isOpen = useQueueSheet();
  const [side, setSide] = useState<MiniQueueSide>('below');

  useEffect(() => {
    if (!isOpen) {
      const shrink = setTimeout(
        () => void call('window.setMiniQueue', { open: false }),
        motionDuration('--dur-mid') * 1000,
      );
      return () => clearTimeout(shrink);
    }
    let isStale = false;
    void call('window.setMiniQueue', { open: true }).then((result) => {
      if (isStale) return;
      if (!result.ok) {
        showToast({ message: result.error.message, level: 'error' });
        closeQueueSheet();
        return;
      }
      flushSync(() => setSide(result.value));
      // The second one is the frame after the one with the strip in it.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!isStale) void call('window.growMiniForQueue');
        }),
      );
    });
    return () => {
      isStale = true;
    };
  }, [isOpen]);

  return { isOpen, side };
}
