/*
 * One number per track for how intense it sounds, and when radio asks for a calmer one: pure. Energy only ever chooses among
 * picks that already qualify. Why it's built this way, and how far to trust it, is in docs/research/energy.md.
 */
import { BREATHER_NEVER, type RadioEnergy } from '@shared/domain';

/** How far either way ordinary songs may stray, at the loosest and tightest the setting goes. */
const HOLD_LOOSEST = 0.35;
const HOLD_TIGHTEST = 0.1;
/** A breather's aim, either way. */
const DROP_WIDTH = 0.1;
const MOST_LEAN = 0.2;

export const ENERGY_RULES = {
  /** Different files of one song disagree by up to this, so a smaller gap isn't a difference. */
  noDifference: 0.08,
  /** Only the best of what passes the floor can be a calm pick, or it would reach past what radio would ever play. */
  closestPicks: 60,
  anchorTracks: 9,
} as const;

export type EnergyTuning = {
  /** How far ordinary songs may stray from the current energy, or null for as far as they like. */
  hold: number | null;
  dipsPerPick: number;
  drop: number;
  returnPicks: number;
  /** Added to a candidate's rank for each unit of its energy, so it can lean calmer or more intense among what qualifies. */
  lean: number;
};

export function energyTuning({ lean, hold, everySongs, drop, climbSongs }: RadioEnergy): EnergyTuning {
  return {
    hold: hold === 0 ? null : HOLD_LOOSEST + (HOLD_TIGHTEST - HOLD_LOOSEST) * hold,
    dipsPerPick: everySongs >= BREATHER_NEVER ? 0 : 1 / everySongs,
    drop,
    returnPicks: climbSongs,
    lean: (lean - 0.5) * 2 * MOST_LEAN,
  };
}

/** Rank over rank count, with ties sharing their middle. Each head has its own scale, and a stored vector's isn't a probability. */
export function percentiles(values: ArrayLike<number>): Float32Array {
  const order = Array.from({ length: values.length }, (_, i) => i).toSorted(
    (a, b) => (values[a] as number) - (values[b] as number),
  );
  const ranks = new Float32Array(values.length);
  const top = Math.max(order.length - 1, 1);
  for (let from = 0; from < order.length;) {
    let to = from;
    while (to + 1 < order.length && values[order[to + 1] as number] === values[order[from] as number]) to += 1;
    for (let at = from; at <= to; at++) ranks[order[at] as number] = (from + to) / 2 / top;
    from = to + 1;
  }
  return ranks;
}

/** Each input has higher as more energetic. An average of percentiles, 0 to 1, by row. */
export function blendEnergy(heads: readonly ArrayLike<number>[]): Float32Array {
  const ranked = heads.map(percentiles);
  const rows = ranked[0]?.length ?? 0;
  const blend = new Float32Array(rows);
  for (let row = 0; row < rows; row++) {
    let sum = 0;
    for (const ranks of ranked) sum += ranks[row] as number;
    blend[row] = sum / ranked.length;
  }
  return blend;
}

export type EnergyHistoryItem = { energy: number | null; isCalm: boolean };

export type EnergyState = {
  /** Where the session sits. Dips are measured from here, not the last track, or repeated ones would ratchet down. */
  anchor: number;
  /** Picks since the last calm one, or since the start. */
  sinceCalm: number;
  calmEnergy: number | null;
  /** Of the track before the next pick. */
  last: number | null;
};

function median(values: readonly number[]): number | null {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = sorted[Math.floor(sorted.length / 2)];
  if (middle === undefined) return null;
  return sorted.length % 2 === 1 ? middle : (middle + (sorted[sorted.length / 2 - 1] as number)) / 2;
}

/** Null when nothing in it has an energy, and then there's nothing to measure from. History is oldest first. */
export function energyState(history: readonly EnergyHistoryItem[], returnPicks: number): EnergyState | null {
  let sinceDip = Infinity;
  const ordinary: number[] = [];
  const known: number[] = [];
  for (const { energy, isCalm } of history) {
    sinceDip = isCalm ? 0 : sinceDip + 1;
    if (energy === null) continue;
    known.push(energy);
    if (sinceDip > returnPicks) ordinary.push(energy);
  }
  const anchor = median((ordinary.length > 0 ? ordinary : known).slice(-ENERGY_RULES.anchorTracks));
  if (anchor === null) return null;

  const lastCalm = history.findLastIndex(({ isCalm }) => isCalm);
  return {
    anchor,
    sinceCalm: lastCalm >= 0 ? history.length - 1 - lastCalm : Math.max(history.length - 1, 0),
    calmEnergy: history[lastCalm]?.energy ?? null,
    last: history.at(-1)?.energy ?? null,
  };
}

export type EnergySlot = { kind: 'ordinary' } | { kind: 'hold' | 'calm' | 'return'; low: number; high: number };

/** Worked out afresh each slot, so picks can be made again: the chance rises so that gaps come out even across the range. */
function isDipDue(sinceCalm: number, { dipsPerPick }: EnergyTuning, random: () => number): boolean {
  if (dipsPerPick === 0) return false;
  const shortest = Math.round(0.8 / dipsPerPick);
  const longest = Math.round(1.2 / dipsPerPick);
  const gap = sinceCalm + 1;
  if (gap < shortest) return false;
  return gap >= longest || random() < 1 / (longest - gap + 1);
}

/** What an ordinary song has to be. A slot nothing close can fill falls back to this, and this to the plain best pick. */
export function steadySlot({ anchor }: EnergyState, { hold }: EnergyTuning): EnergySlot {
  return hold === null ? { kind: 'ordinary' } : { kind: 'hold', low: anchor - hold, high: anchor + hold };
}

export function nextSlot(state: EnergyState, tuning: EnergyTuning, random: () => number): EnergySlot {
  const { anchor, sinceCalm, calmEnergy, last } = state;
  const { noDifference } = ENERGY_RULES;
  if (calmEnergy !== null && calmEnergy < anchor && sinceCalm < tuning.returnPicks) {
    const target = calmEnergy + ((anchor - calmEnergy) * (sinceCalm + 1)) / (tuning.returnPicks + 1);
    return { kind: 'return', low: target - noDifference, high: target + noDifference };
  }
  // Going "down" from a song that's already low would be a step up.
  if (last !== null && last < anchor - noDifference) return steadySlot(state, tuning);
  if (!isDipDue(sinceCalm, tuning, random)) return steadySlot(state, tuning);
  const aim = anchor - tuning.drop;
  return {
    kind: 'calm',
    low: aim - DROP_WIDTH,
    high: Math.min(aim + DROP_WIDTH, Math.min(anchor, last ?? anchor) - noDifference),
  };
}

export function fitsSlot(slot: EnergySlot, energy: number | null): boolean {
  if (slot.kind === 'ordinary') return true;
  return energy !== null && energy >= slot.low && energy <= slot.high;
}

export function afterPick(state: EnergyState, wasCalm: boolean, energy: number | null): EnergyState {
  return wasCalm
    ? { ...state, sinceCalm: 0, calmEnergy: energy, last: energy }
    : { ...state, sinceCalm: state.sinceCalm + 1, last: energy };
}
