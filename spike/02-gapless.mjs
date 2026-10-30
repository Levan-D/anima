/*
 * Silent. Proves gapless sample-for-sample: decode Music and Noise separately,
 * then play tail-of-Music into Noise through mpv's PCM writer and compare bytes.
 */
import { readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { startMpv, MUSIC, NOISE, OUT, MPV, HEADLESS } from './lib.mjs';

function decode(input, name, extra = []) {
  const file = join(OUT, name);
  rmSync(file, { force: true });
  const result = spawnSync(MPV, [...HEADLESS.filter((a) => a !== '--idle=yes'), '--media-controls=no', '--ao=pcm', `--ao-pcm-file=${file}`, '--ao-pcm-waveheader=no', '--audio-format=s32', ...extra, input], { stdio: 'ignore' });
  if (result.status !== 0) throw new Error(`decode failed ${result.status}`);
  return file;
}

async function chain(gapless, name) {
  const file = join(OUT, name);
  rmSync(file, { force: true });
  const mpv = await startMpv(['--ao=pcm', `--ao-pcm-file=${file}`, '--ao-pcm-waveheader=no', '--audio-format=s32', `--gapless-audio=${gapless}`, '--media-controls=no']);
  await mpv.command('loadfile', MUSIC, 'replace', -1, 'start=-10');
  await mpv.command('loadfile', NOISE, 'append', -1, 'end=10');
  await mpv.waitFor((e) => e.event === 'end-file' && e.playlist_entry_id === 2, 120000, 'second file end');
  const events = mpv.events.filter((e) => e.event !== 'property-change').map((e) => e.event + (e.reason ? `:${e.reason}` : '')).join(' > ');
  await mpv.quit();
  return { file, events };
}

const frame = 8; // s32 stereo
function report(label, output, music, noise) {
  const tail = music.subarray(music.length - frame * 4410);
  const start = output.indexOf(tail);
  if (start < 0) return console.log(label, 'could not locate tail of Music in the output');
  const boundary = start + tail.length;
  const after = output.subarray(boundary);
  const compareLength = Math.min(after.length, noise.length);
  let firstDifference = -1;
  for (let i = 0; i < compareLength; i++) if (after[i] !== noise[i]) { firstDifference = i; break; }
  const expectedTotal = (start + tail.length) + noise.length;
  console.log(label, {
    tailFoundAtFrame: start / frame,
    noiseFramesCompared: compareLength / frame,
    identicalAcrossBoundary: firstDifference === -1,
    firstDifferentFrame: firstDifference === -1 ? null : Math.floor(firstDifference / frame),
    trailingBytesAfterNoise: output.length - expectedTotal,
  });
  const look = after.subarray(0, frame * 8);
  console.log('  first frames after the boundary', look.toString('hex').match(/.{1,16}/g).slice(0, 4).join(' '));
  console.log('  last frame of Music            ', tail.subarray(tail.length - frame).toString('hex'));
  console.log('  first frame of Noise           ', noise.subarray(0, frame).toString('hex'));
}

const music = readFileSync(decode(MUSIC, 'music.pcm'));
const noise = readFileSync(decode(NOISE, 'noise-10s.pcm', ['--end=10']));
console.log('Music frames', music.length / frame, 'Noise (10s) frames', noise.length / frame);
console.log('Music ends with silence?', music.subarray(music.length - frame * 4).every((b) => b === 0), ' Noise starts with silence?', noise.subarray(0, frame * 4).every((b) => b === 0));
const lastPeak = Math.abs(music.readInt32LE(music.length - frame));
console.log('|last sample of Music| as fraction of full scale', (lastPeak / 2147483648).toFixed(6), ' |first sample of Noise|', (Math.abs(noise.readInt32LE(0)) / 2147483648).toFixed(6));

for (const mode of ['weak', 'yes', 'no']) {
  const { file, events } = await chain(mode, `chain-${mode}.pcm`);
  const output = readFileSync(file);
  console.log(`\n--- gapless-audio=${mode}: ${(statSync(file).size / frame)} frames`);
  console.log('  events', events);
  report(`  ${mode}`, output, music, noise);
}
