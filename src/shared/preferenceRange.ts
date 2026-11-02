/*
 * The band behind "Preference range (SenseLab data, ours)". Derived once from CC BY 4.0 data, https://zenodo.org/records/8388242,
 * and not fetched or recomputed by the app. THIRD_PARTY_NOTICES.md has the attribution, docs/research/headphone-eq.md the method.
 *
 * Each of the 11 curves rated no worse than the best is aligned by the app's rule, and this is the lowest and highest of them at
 * each third octave. They're eardrum responses on a B&K 5128, so a raw 5128 measurement goes straight against them.
 * It stops at 100 Hz because those ratings don't separate bass levels, and at 10 kHz because the file flatlines near the top.
 */

import { rigMatch } from '@shared/headphoneCurve';
import type { HeadphoneMeasurement, RigTag } from '@shared/headphone';

export const PREFERENCE_RANGE = {
  hz: [
    100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000, 5000, 6300, 8000,
    10_000,
  ],
  lowDb: [
    -2.9, -3.6, -3.2, -4.3, -4.9, -5.8, -5.2, -3.9, -3.1, -2.3, -1.2, -1.2, -0.8, 1.9, 3.8, 4.3, 1.2, 2.2, 2.3, 2.2, -2,
  ],
  highDb: [1.5, 0.8, -0.6, -1.4, -1.6, -1.8, -2.5, -1.8, -1.1, 0.6, 0.4, 1.7, 2.9, 6, 7, 8.5, 9.5, 8.9, 8.2, 7.8, 6.3],
} as const;

const RANGE_RIG: RigTag = { family: 'bk5128', detail: 'Bruel & Kjaer 5128' };

export type PreferenceRangeFit = 'fits' | 'rig' | 'form';

/** The ratings are of over-ear responses on a 5128, so an in-ear on the same rig isn't covered, and nor is a pair of unknown form. */
export function preferenceRangeFit({ rig, form }: Pick<HeadphoneMeasurement, 'rig' | 'form'>): PreferenceRangeFit {
  const match = rigMatch(rig, { rig: RANGE_RIG, isTranslated: false });
  if (match === 'different' || match === 'unknown') return 'rig';
  return form === 'over-ear' ? 'fits' : 'form';
}
