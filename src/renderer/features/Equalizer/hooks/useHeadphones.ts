import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { HeadphoneKind, HeadphoneState } from '@shared/headphone';
import type { CommandInput } from '@shared/ipc/contract';
import { preferenceRangeFit } from '@shared/preferenceRange';
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
  const [isMatching, setIsMatching] = useState(false);
  const [isFetchingCurves, setIsFetchingCurves] = useState(false);
  const [curvesProblem, setCurvesProblem] = useState<string | null>(null);
  const hasTriedCurves = useRef(false);
  const { data: state } = useQuery(stateQuery);
  const isOpen = state?.options.isOpen ?? false;
  const measurementId = state?.measurementId ?? null;
  const targetId = state?.targetId ?? null;
  const { data: measurementCurve = null } = useQuery(curveQuery('measurement', measurementId, isOpen));
  const { data: targetCurve = null } = useQuery(curveQuery('target', targetId, isOpen));

  const measurement = state?.measurements.find(({ id }) => id === measurementId) ?? null;
  const target = state?.targets.find(({ id }) => id === targetId) ?? null;
  const rangeFits = measurement !== null && preferenceRangeFit(measurement) === 'fits';
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

  const canShowRange = lines !== null && rangeFits;
  const isRangeShown = canShowRange && !lines.isDifference && (state?.options.showRange ?? false);

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

  function fetchCurves(isAsked: boolean): void {
    setIsFetchingCurves(true);
    setCurvesProblem(null);
    void call('autoeq.fetchTargets').then((result) => {
      setIsFetchingCurves(false);
      if (!result.ok) {
        setCurvesProblem(result.error.message);
        return;
      }
      const { state: next, added, updated, failed } = result.value;
      adopt(next);
      if (failed > 0) {
        showToast({
          message: `${failed} of AutoEq's curves couldn't be fetched. Refetch to try again`,
          level: 'warning',
        });
      } else if (isAsked) {
        const changed = added + updated;
        const words = changed === 0 ? 'Curves are up to date' : `${added} new, ${updated} updated`;
        showToast({ message: words, level: 'info' });
      }
    });
  }

  // The first time the tools are open, so the list is just there from then on.
  const needsCurves = isOpen && state !== undefined && state.targetsFetchedAt === null;
  useEffect(() => {
    if (!needsCurves || hasTriedCurves.current) return;
    hasTriedCurves.current = true;
    fetchCurves(false);
  });

  return {
    state: state ?? null,
    measurement,
    target,
    match,
    lines,
    canShowRange,
    isRangeShown,
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
    isFetchingCurves,
    curvesProblem,
    refetchCurves: () => fetchCurves(true),
    isMatching,
    fitToTarget: (ids: CommandInput<'headphones.match'>) => {
      setIsMatching(true);
      void call('headphones.match', ids).then((result) => {
        setIsMatching(false);
        if (!result.ok) showToast({ message: result.error.message, level: 'error' });
      });
    },
    setMatch: (input: CommandInput<'headphones.setMatch'>) => run(call('headphones.setMatch', input)),
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
