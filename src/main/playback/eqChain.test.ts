import { describe, expect, it } from 'vitest';
import type { EqBand } from '@shared/domain';
import { chainFor, chainSpec, nextEqStep, type EqChain, type HeldEq } from './eqChain';

const PEAK: EqBand = { id: 1, kind: 'peak', frequencyHz: 1000, gainDb: 6, q: 1 };
const SHELF: EqBand = { id: 2, kind: 'lowshelf', frequencyHz: 80, gainDb: 0, q: 0.707 };

const chain = (...bands: EqBand[]): EqChain => chainFor({ enabled: true, bands });

function held(wanted: EqChain): HeldEq {
  return { spec: chainSpec(wanted), live: wanted };
}

/** Runs the steps as the Player does, each from where the last one left it. */
function stepsTo(from: HeldEq, wanted: EqChain | null, isMoving: boolean) {
  const steps = [];
  let state = from;
  for (let step = nextEqStep(state, wanted, isMoving); step !== null; step = nextEqStep(state, wanted, isMoving)) {
    steps.push(step);
    if (step.kind === 'clear') state = { spec: null, live: null };
    else if (step.kind === 'set') state = { spec: step.spec, live: step.chain };
    else state = { ...state, live: step.live };
  }
  return steps;
}

describe('chainSpec', () => {
  it('is one filter per label, the preamp first', () => {
    const bands = [PEAK, SHELF, { ...PEAK, kind: 'highshelf' as const, frequencyHz: 12_500.5, gainDb: -3 }];
    expect(chainSpec({ preampDb: -6, bands })).toBe(
      '@eqpre:lavfi=[volume=-6dB],@eq1:lavfi=[equalizer=f=1000:t=q:w=1:g=6],@eq2:lavfi=[lowshelf=f=80:t=q:w=0.707:g=0],@eq3:lavfi=[highshelf=f=12500.5:t=q:w=1:g=-3]',
    );
  });
});

describe('nextEqStep', () => {
  it('has nothing to do when off and already off', () => {
    expect(nextEqStep({ spec: null, live: null }, null, false)).toBeNull();
  });

  it('sets when it turns on, and clears when it goes off', () => {
    expect(nextEqStep({ spec: null, live: null }, chain(PEAK), false)).toMatchObject({ kind: 'set' });
    expect(nextEqStep(held(chain(PEAK)), null, false)).toEqual({ kind: 'clear' });
  });

  it('sets when a band comes, goes or changes kind', () => {
    const now = held(chain(PEAK, SHELF));
    expect(nextEqStep(now, chain(PEAK), true)).toMatchObject({ kind: 'set' });
    expect(nextEqStep(now, chain(PEAK, SHELF, { ...PEAK, id: 3 }), true)).toMatchObject({ kind: 'set' });
    expect(nextEqStep(now, chain(PEAK, { ...SHELF, kind: 'peak' }), true)).toMatchObject({ kind: 'set' });
  });

  it('commands a value that moves, naming the filter inside the label', () => {
    const now = held(chain(PEAK, SHELF));
    const steps = stepsTo(now, chain(PEAK, { ...SHELF, frequencyHz: 100, q: 2 }), true);
    expect(steps.map((step) => (step.kind === 'command' ? step.args : step.kind))).toEqual([
      ['eq2', 'frequency', '100', 'Parsed_lowshelf_0'],
      ['eq2', 'width', '2', 'Parsed_lowshelf_0'],
    ]);
  });

  it('opens the headroom before a boost, and closes it after a cut', () => {
    const six = held(chain(PEAK));
    expect(
      stepsTo(six, chain({ ...PEAK, gainDb: 9 }), true).map((step) => step.kind === 'command' && step.args[1]),
    ).toEqual(['volume', 'gain']);
    expect(
      stepsTo(six, chain({ ...PEAK, gainDb: 2 }), true).map((step) => step.kind === 'command' && step.args[1]),
    ).toEqual(['gain', 'volume']);
  });

  it('writes down what mpv rebuilds from once it has stopped moving', () => {
    const moved = chain({ ...PEAK, gainDb: 3 });
    const commanded = { spec: chainSpec(chain(PEAK)), live: moved };
    expect(nextEqStep(commanded, moved, true)).toBeNull();
    expect(nextEqStep(commanded, moved, false)).toEqual({ kind: 'set', spec: chainSpec(moved), chain: moved });
  });

  it('goes back to a set when it no longer knows what the filters are doing', () => {
    const wanted = chain({ ...PEAK, gainDb: 3 });
    expect(nextEqStep({ spec: chainSpec(chain(PEAK)), live: null }, wanted, true)).toMatchObject({ kind: 'set' });
    expect(nextEqStep({ spec: chainSpec(chain(PEAK)), live: null }, null, true)).toEqual({ kind: 'clear' });
  });
});
