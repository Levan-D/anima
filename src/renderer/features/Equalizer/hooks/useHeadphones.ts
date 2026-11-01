import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { HeadphoneKind, HeadphoneState } from '@shared/headphone';
import type { CommandInput } from '@shared/ipc/contract';
import type { Result } from '@shared/result';
import { fixedLines, matchOf, type FixedLines } from '@/features/Equalizer/utils/headphoneLines';
import { call, unwrap } from '@/lib/api';
import { showToast } from '@/lib/toastStore';

const stateQuery = queryOptions({
  queryKey: ['headphones', 'state'],
  queryFn: () => call('headphones.state').then(unwrap),
});

function curveQuery(kind: HeadphoneKind, id: number | null, isWanted: boolean) {
  return queryOptions({
    queryKey: ['headphones', 'curve', kind, id],
    queryFn: () => (id === null ? null : call('headphones.curve', { kind, id }).then(unwrap)),
    enabled: id !== null && isWanted,
    staleTime: Infinity,
  });
}

/** The store as main keeps it, and the lines to draw. Only touches a curve once the tools are open. */
export function useHeadphones() {
  const client = useQueryClient();
  const { data: state } = useQuery(stateQuery);
  const isOpen = state?.options.isOpen ?? false;
  const measurementId = state?.measurementId ?? null;
  const targetId = state?.targetId ?? null;
  const { data: measurementCurve = null } = useQuery(curveQuery('measurement', measurementId, isOpen));
  const { data: targetCurve = null } = useQuery(curveQuery('target', targetId, isOpen));

  const measurement = state?.measurements.find(({ id }) => id === measurementId) ?? null;
  const target = state?.targets.find(({ id }) => id === targetId) ?? null;
  const match = matchOf(measurement, target);
  const showRaw = state?.options.showRaw ?? false;
  const showDifference = state?.options.showDifference ?? false;
  const bassDb = state?.options.bassDb ?? 0;

  const lines: FixedLines | null = useMemo(
    () =>
      isOpen && measurementCurve !== null
        ? fixedLines({ measurement: measurementCurve, target: targetCurve, match, showRaw, showDifference, bassDb })
        : null,
    [isOpen, measurementCurve, targetCurve, match, showRaw, showDifference, bassDb],
  );

  function adopt(next: HeadphoneState): void {
    client.setQueryData(stateQuery.queryKey, next);
  }

  /** The state a command came back with, or what went wrong as a toast. */
  function run(pending: Promise<Result<HeadphoneState>>): void {
    void pending.then((result) => {
      if (result.ok) adopt(result.value);
      else showToast({ message: result.error.message, level: 'error' });
    });
  }

  return {
    state: state ?? null,
    measurement,
    target,
    match,
    lines,
    hasTargetCurve: targetCurve !== null,
    adopt,
    setOption: (option: CommandInput<'headphones.setOption'>) => run(call('headphones.setOption', option)),
    select: (ids: { measurementId?: number | null; targetId?: number | null }) => {
      run(
        call('headphones.select', {
          measurementId: ids.measurementId === undefined ? measurementId : ids.measurementId,
          targetId: ids.targetId === undefined ? targetId : ids.targetId,
        }),
      );
    },
    remove: (kind: HeadphoneKind, id: number) => run(call('headphones.remove', { kind, id })),
    fetchTarget: (file: string) => run(call('autoeq.fetchTarget', { file })),
    usePreset: (id: number) => {
      void call('headphones.usePreset', { measurementId: id }).then((result) => {
        if (!result.ok) {
          showToast({ message: result.error.message, level: 'error' });
          return;
        }
        const { clampedBands } = result.value;
        if (clampedBands === 0) return;
        const bands = clampedBands === 1 ? '1 band' : `${clampedBands} bands`;
        showToast({ message: `Gain brought down to 12 dB on ${bands}, so it won't match its curve`, level: 'warning' });
      });
    },
  };
}

export type Headphones = ReturnType<typeof useHeadphones>;
