/* What goes on the plot for a measurement, and what the screen says about it. docs/research/headphone-eq.md has the wording. */

import { EQ_MAX_GAIN_DB, EQ_MAX_HZ, EQ_MIN_HZ } from '@shared/domain';
import { differenceLine, measuredLine, plotRangeDb, rigMatch, targetLine, type RigMatch } from '@shared/headphoneCurve';
import { rigWords, type FrCurve, type HeadphoneMeasurement, type HeadphoneTarget } from '@shared/headphone';
import { xOfHz, yOfGain } from '@/features/Equalizer/utils/eqBands';

const VIEW = 1000;

/** The curve in a viewBox of 1000 by 1000, on the plot's one scale. What runs off the plot is cut by the SVG, not moved. */
export function linePath({ hz, db }: FrCurve, rangeDb: number): string {
  const points: string[] = [];
  for (const [point, at] of hz.entries()) {
    if (at < EQ_MIN_HZ || at > EQ_MAX_HZ) continue;
    points.push(`${(xOfHz(at) * VIEW).toFixed(1)} ${(yOfGain(db[point] ?? 0, rangeDb) * VIEW).toFixed(1)}`);
  }
  return points.length === 0 ? '' : `M${points.join('L')}`;
}

export type HeadphoneInputs = {
  measurement: FrCurve | null;
  target: FrCurve | null;
  match: RigMatch;
  showRaw: boolean;
  showDifference: boolean;
  bassDb: number;
};

/** What stays put while a node moves. */
export type FixedLines = {
  measured: FrCurve | null;
  target: FrCurve | null;
  /** The target, if it may be shown at all. */
  isTargetShown: boolean;
  isDifference: boolean;
  rangeDb: number;
};

export function fixedLines({
  measurement,
  target,
  match,
  showRaw,
  showDifference,
  bassDb,
}: HeadphoneInputs): FixedLines {
  const isTargetShown = target !== null && (match === 'defined' || match === 'approximate');
  const shape = isTargetShown ? targetLine(target, bassDb) : null;
  const isDifference = showDifference && shape !== null;
  if (measurement === null) {
    return { measured: null, target: null, isTargetShown: false, isDifference: false, rangeDb: EQ_MAX_GAIN_DB };
  }
  const plain = measuredLine(measurement, showRaw);
  const measured = isDifference ? differenceLine(plain, shape) : plain;
  return {
    measured,
    target: isDifference ? null : shape,
    isTargetShown,
    isDifference,
    rangeDb: plotRangeDb(shape === null || isDifference ? [measured] : [measured, shape]),
  };
}

export function matchOf(measurement: HeadphoneMeasurement | null, target: HeadphoneTarget | null): RigMatch {
  return measurement === null || target === null ? 'unknown' : rigMatch(measurement.rig, target);
}

export const CAVEAT = "Your pair and your head will differ, most of all above 6 kHz and in the bass if it doesn't seal";
export const ALIGNED = 'Aligned over 300 Hz to 3 kHz';
export const BASS_NOTE =
  'A target is a majority preference. In Olive 2022, 64% of listeners preferred it, 15% wanted 4 to 6 dB more bass, and 21% about 2 dB less';
export const COMPARE_NOTE = 'Matched by curve, not by loudness measurement';

function measuredName({ source, headphone, rig }: HeadphoneMeasurement): string {
  return `${source}'s ${headphone} (${rigWords(rig)})`;
}

export function predictedWords(measurement: HeadphoneMeasurement): string {
  return `Predicted, not measured: ${measuredName(measurement)} plus your EQ`;
}

export function measuredWords(measurement: HeadphoneMeasurement, showRaw: boolean): string {
  return `Measured: ${measuredName(measurement)}, ${showRaw ? 'raw, as loaded' : 'smoothed to 1/12 octave'}`;
}

/** Where a measurement came from, so nobody takes it for their own pair. */
export function originWords({ origin, source }: HeadphoneMeasurement): string {
  if (origin.kind === 'file') return `From your file, as ${source}'s`;
  return `One unit, on ${source}'s rig. Fetched from AutoEq at ${origin.commit.slice(0, 7)}, kept on this machine`;
}

const TARGET_TOOLS = 'Difference, Bass and Match to target';

/** Why some of the controls are off for this pick, and what turns them on. Null when nothing is. */
export function whatsOffWords(
  measurement: HeadphoneMeasurement | null,
  target: HeadphoneTarget | null,
  match: RigMatch,
  hasTargetCurve: boolean,
): string | null {
  if (measurement === null) return 'Pick a headphone to turn these on';
  if (!measurement.hasCurve) {
    return `No public measurement from ${measurement.source}, so only AutoEq's correction works. Another source on AutoEq may have one`;
  }
  if (target === null) return `Pick a target to turn on ${TARGET_TOOLS}`;
  if (!hasTargetCurve) return `This target has no curve, so ${TARGET_TOOLS} are off`;
  if (match === 'different') {
    return `This target is from a different rig than this measurement, so ${TARGET_TOOLS} are off. Pick one marked Same rig or Close rig`;
  }
  if (match === 'unknown') {
    return `A rig here isn't known, so these can't be compared. ${TARGET_TOOLS} are off`;
  }
  return null;
}

/** What's said about the target, in each state. Null with nothing to say. */
export function targetWords(target: HeadphoneTarget | null, match: RigMatch, hasCurve: boolean): string | null {
  if (target === null || !hasCurve) return null;
  const { name, rig, isTranslated } = target;
  const words: Record<RigMatch, string> = {
    defined: `${name} is defined on this rig`,
    approximate: `${name} is approximate here: ${isTranslated ? `translated to ${rigWords(rig)} by AutoEq` : `${rigWords(rig)} is the same family of rig, not the same one`}`,
    different: `${name} is defined on another rig. Not shown against this measurement`,
    unknown: `This measurement's rig isn't known, so ${name} isn't shown against it`,
  };
  return words[match];
}

export function differenceWords(target: HeadphoneTarget): string {
  return `Difference from ${target.name}`;
}

export function compareShortWords(shortByDb: number): string | null {
  return shortByDb > 0 ? `The off side can't go louder than the file, so it's ${shortByDb} dB quieter here` : null;
}
