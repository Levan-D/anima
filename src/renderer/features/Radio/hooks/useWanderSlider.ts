import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { setRadioWander } from '@/lib/playerActions';
import { queryKeys } from '@/lib/queryKeys';

export type WanderSlider = {
  value: number;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
};

/** Follows the thumb while it's held, and only tells main when it's let go, since that re-picks what's ahead. */
export function useWanderSlider(saved: number): WanderSlider {
  const queryClient = useQueryClient();
  const [held, setHeld] = useState<number | null>(null);

  return {
    value: held ?? saved,
    onChange: setHeld,
    onCommit: (value) => {
      void setRadioWander(value).then(() => {
        setHeld(null);
        void queryClient.invalidateQueries({ queryKey: queryKeys.radioPreviews });
      });
    },
  };
}
