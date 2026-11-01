import { useEffect } from 'react';
import { currentPage } from '@/lib/pages';
import { onPlayerChange, playerState } from '@/lib/playerStore';
import { showToast } from '@/lib/toastStore';

const STOPPED_PICKING = 'Radio has nothing close left to play';

/** The Radio page says so itself. From anywhere else, this is the only way to hear that the music will stop. */
export function useRadioNotice(): void {
  useEffect(() => {
    let last = playerState().radio.problem;
    return onPlayerChange(({ radio: { problem } }) => {
      if (problem !== null && problem !== last && currentPage() !== 'radio') showToast({ message: STOPPED_PICKING });
      last = problem;
    });
  }, []);
}
