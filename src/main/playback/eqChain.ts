/*
 * The EQ as mpv's filter chain, and the one next thing to send to bring it to what's wanted. mpv rebuilds a filter from
 * its `af set` text at every seek and every new file, which undoes anything `af-command` did, so a value has two lives:
 * commanded for as long as it's moving, because that doesn't touch the stream, then set once it has stopped.
 */

import type { EqBand, EqBandKind, EqSettings } from '@shared/domain';
import { effectivePreampDb } from '@shared/eqCurve';

export type EqChain = {
  preampDb: number;
  bands: Omit<EqBand, 'id'>[];
};

/** What mpv holds. Both are null with no chain. `live` alone is null when what the filters are doing isn't known. */
export type HeldEq = {
  spec: string | null;
  live: EqChain | null;
};

export type EqStep =
  | { kind: 'clear' }
  | { kind: 'set'; spec: string; chain: EqChain }
  /** `live` is what the filters are doing once this has gone. */
  | { kind: 'command'; args: string[]; live: EqChain };

const FILTERS: Record<EqBandKind, string> = { peak: 'equalizer', lowshelf: 'lowshelf', highshelf: 'highshelf' };

const PREAMP_LABEL = 'eqpre';
const PREAMP_TARGET = 'Parsed_volume_0';

function number(value: number): string {
  return String(Number(value.toFixed(3)));
}

function decibels(value: number): string {
  return `${number(value)}dB`;
}

export function chainFor(eq: EqSettings): EqChain {
  const { bands } = eq;
  return {
    preampDb: effectivePreampDb(eq),
    bands: bands.map(({ kind, frequencyHz, gainDb, q }) => ({ kind, frequencyHz, gainDb, q })),
  };
}

export function chainSpec({ preampDb: preamp, bands }: EqChain): string {
  const filters = bands.map(
    ({ kind, frequencyHz, gainDb, q }, index) =>
      `@eq${index + 1}:lavfi=[${FILTERS[kind]}=f=${number(frequencyHz)}:t=q:w=${number(q)}:g=${number(gainDb)}]`,
  );
  return [`@${PREAMP_LABEL}:lavfi=[volume=${decibels(preamp)}]`, ...filters].join(',');
}

function sameStructure(a: EqChain, b: EqChain): boolean {
  return a.bands.length === b.bands.length && a.bands.every(({ kind }, index) => kind === b.bands[index]?.kind);
}

function bandCommand(live: EqChain, wanted: EqChain): EqStep | null {
  for (const [index, band] of wanted.bands.entries()) {
    const was = live.bands[index];
    if (was === undefined) continue;
    const send = (command: string, value: number, changed: Partial<EqBand>): EqStep => ({
      kind: 'command',
      args: [`eq${index + 1}`, command, number(value), `Parsed_${FILTERS[band.kind]}_0`],
      live: { ...live, bands: live.bands.map((other, at) => (at === index ? { ...other, ...changed } : other)) },
    });
    if (was.gainDb !== band.gainDb) return send('gain', band.gainDb, { gainDb: band.gainDb });
    if (was.frequencyHz !== band.frequencyHz)
      return send('frequency', band.frequencyHz, { frequencyHz: band.frequencyHz });
    if (was.q !== band.q) return send('width', band.q, { q: band.q });
  }
  return null;
}

function preampCommand(live: EqChain, wanted: EqChain): EqStep {
  return {
    kind: 'command',
    args: [PREAMP_LABEL, 'volume', decibels(wanted.preampDb), PREAMP_TARGET],
    live: { ...live, preampDb: wanted.preampDb },
  };
}

/**
 * Null when mpv is where it should be. `isMoving` says more values may be coming, so what mpv would rebuild from can wait.
 * Headroom opens before a boost and closes after a cut, so nothing clips on the way.
 */
export function nextEqStep({ spec, live }: HeldEq, wanted: EqChain | null, isMoving: boolean): EqStep | null {
  if (wanted === null) return spec === null ? null : { kind: 'clear' };

  const wantedSpec = chainSpec(wanted);
  if (spec === null || live === null || !sameStructure(live, wanted)) {
    return { kind: 'set', spec: wantedSpec, chain: wanted };
  }

  if (wanted.preampDb < live.preampDb) return preampCommand(live, wanted);
  const band = bandCommand(live, wanted);
  if (band !== null) return band;
  if (wanted.preampDb !== live.preampDb) return preampCommand(live, wanted);

  return !isMoving && spec !== wantedSpec ? { kind: 'set', spec: wantedSpec, chain: wanted } : null;
}
