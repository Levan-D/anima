/*
 * Silent. Live EQ: does af-command change a labeled lavfi equalizer in place, and
 * does it glitch? A 1 kHz sine runs through the PCM writer. The gain changes
 * mid-stream, then the output is checked for amplitude and sample-level jumps.
 */
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { startMpv, OUT, sleep } from './lib.mjs';

const RATE = 48000;
const SOURCE = `av://lavfi:sine=frequency=1000:sample_rate=${RATE}:duration=3600`;

async function run(name, band, change) {
  const file = join(OUT, `${name}.pcm`);
  rmSync(file, { force: true });
  const mpv = await startMpv(['--ao=pcm', `--ao-pcm-file=${file}`, '--ao-pcm-waveheader=no', '--audio-format=float', '--media-controls=no', `--af=${band}`]);
  await mpv.observe(1, 'time-pos');
  await mpv.command('loadfile', SOURCE, 'replace');
  // The PCM writer runs far faster than real time, so positions jump between events.
  await mpv.waitFor((e) => e.name === 'time-pos' && e.data > 2, 30000, 'pos>2');
  const at = await mpv.get('time-pos');
  const reply = await change(mpv);
  console.log(`  ${name} change at ~${at}s, reply ${JSON.stringify(reply)}`);
  const af = await mpv.get('af');
  console.log('  af now', JSON.stringify(af));
  await mpv.waitFor((e) => e.name === 'time-pos' && e.data > at + 4, 30000, 'later position');
  await mpv.quit();
  return new Float32Array(readFileSync(file).buffer.slice(0));
}

function rms(samples) { let sum = 0; for (const s of samples) sum += s * s; return Math.sqrt(sum / samples.length); }

function analyze(label, stereo) {
  const mono = stereo.filter((_, i) => i % 2 === 0);
  console.log(`  ${label}: ${mono.length} frames`);
  const windowSize = 4800;
  const levels = [];
  for (let i = 0; i + windowSize <= mono.length; i += windowSize) levels.push(rms(mono.subarray(i, i + windowSize)));
  const first = levels[2]; const last = levels.at(-3);
  const db = 20 * Math.log10(last / first);
  console.log(`  level: before ${first.toFixed(5)}  after ${last.toFixed(5)}  change ${db.toFixed(2)} dB`);
  // A clean sine obeys x[n] ~= 2cos(w)x[n-1] - x[n-2]; any click shows up as a large residual.
  const k = 2 * Math.cos(2 * Math.PI * 1000 / RATE);
  let worst = 0; let worstAt = 0;
  for (let n = 2; n < mono.length; n++) {
    const residual = Math.abs(mono[n] - (k * mono[n - 1] - mono[n - 2]));
    if (residual > worst) { worst = residual; worstAt = n; }
  }
  console.log(`  largest sample-level jump ${worst.toFixed(5)} at ${(worstAt / RATE).toFixed(3)}s (relative to level ${(worst / first).toFixed(3)})`);
  const stepIndex = levels.findIndex((l, i) => i > 0 && Math.abs(20 * Math.log10(l / levels[i - 1])) > 0.3);
  console.log(`  level step found near ${stepIndex < 0 ? 'none' : (stepIndex * windowSize / RATE).toFixed(2)}s`);
}

const band = '@eq1:lavfi=[equalizer=f=1000:t=q:w=1:g=0]';
console.log('--- baseline: no change');
analyze('baseline', await run('eq-baseline', band, () => null));

console.log('--- af-command gain +6 dB, addressed by label');
analyze('af-command gain', await run('eq-command', band, (mpv) => mpv.command('af-command', 'eq1', 'gain', '6')));

console.log('--- af-command short name g -6 dB');
analyze('af-command g', await run('eq-command-g', band, (mpv) => mpv.command('af-command', 'eq1', 'g', '-6')));

console.log('--- rebuilding the chain with af set, for comparison');
analyze('af set', await run('eq-rebuild', band, (mpv) => mpv.command('af', 'set', '@eq1:lavfi=[equalizer=f=1000:t=q:w=1:g=6]')));

console.log('--- two bands: does the command reach only the labeled one?');
const twoBands = '@eq1:lavfi=[equalizer=f=1000:t=q:w=1:g=0],@eq2:lavfi=[equalizer=f=100:t=q:w=1:g=0]';
analyze('two bands, eq2 only (expect no change at 1 kHz)', await run('eq-two', twoBands, (mpv) => mpv.command('af-command', 'eq2', 'gain', '12')));

console.log('--- preamp via labeled volume, runtime command');
analyze('volume filter', await run('eq-volume', '@pre:lavfi=[volume=0dB]', (mpv) => mpv.command('af-command', 'pre', 'volume', '-6dB')));

console.log('--- removing the whole chain at runtime');
analyze('af clr', await run('eq-clear', '@eq1:lavfi=[equalizer=f=1000:t=q:w=1:g=6]', (mpv) => mpv.command('af', 'clr', '')));
await sleep(100);
