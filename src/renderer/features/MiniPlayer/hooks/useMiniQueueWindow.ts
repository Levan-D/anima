import { useEffect, useState } from 'react';
import type { MiniQueueSide } from '@shared/domain';
import { call } from '@/lib/api';
import { closeQueueSheet, useQueueSheet } from '@/lib/queueSheet';
import { showToast } from '@/lib/toastStore';

/** Whether the queue is open and on which side of the strip, with main growing the window around the strip to match. */
export function useMiniQueueWindow(): { isOpen: boolean; side: MiniQueueSide } {
  const isOpen = useQueueSheet();
  const [side, setSide] = useState<MiniQueueSide>('below');

  useEffect(() => {
    void call('window.setMiniQueue', { open: isOpen }).then((result) => {
      if (!result.ok) {
        showToast({ message: result.error.message, level: 'error' });
        closeQueueSheet();
      } else if (isOpen) {
        // Left alone on the way back, since the strip has to hold still until the window has shrunk to it.
        setSide(result.value);
      }
    });
  }, [isOpen]);

  return { isOpen, side };
}
