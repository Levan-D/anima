/*
 * Silent. Does replaygain=album fall back to track gain, and what's the applied gain?
 * Compares RMS of the same 5 seconds with RG off and on.
 */
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { startMpv, OUT, MUSIC } from './lib.mjs';

async function render(name, args) {
  const file = join(OUT, `${name}.pcm`);
  rmSync(file, { force: true });
  const mpv = await startMpv(['--ao=pcm', `--ao-pcm-file=${file}`, '--ao-pcm-waveheader=no', '--audio-format=float', '--media-controls=no', ...args]);
  await mpv.command('loadfile', MUSIC, 'replace', -1, 'start=60,end=65');
  await mpv.waitFor((e) => e.event === 'end-file', 30000, 'end');
  await mpv.quit();
  return new Float32Array(readFileSync(file).buffer.slice(0));
}
const rms = (s) => { let sum = 0; for (const v of s) sum += v * v; return Math.sqrt(sum / s.length); };
const peak = (s) => { let m = 0; for (const v of s) m = Math.max(m, Math.abs(v)); return m; };

const off = await render('rg-off', ['--replaygain=no']);
for (const [name, args] of [
  ['rg-album', ['--replaygain=album']],
  ['rg-track', ['--replaygain=track']],
  ['rg-album-preamp', ['--replaygain=album', '--replaygain-preamp=3']],
  ['volume-50', ['--replaygain=no', '--volume=50']],
]) {
  const on = await render(name, args);
  console.log(name, `applied ${(20 * Math.log10(rms(on) / rms(off))).toFixed(2)} dB, peak ${peak(off).toFixed(4)} -> ${peak(on).toFixed(4)}`);
}
console.log('The file says replaygain_track_gain -6.21 dB');

const mpv = await startMpv(['--ao=null', '--media-controls=no', '--replaygain=album']);
await mpv.command('loadfile', MUSIC, 'replace');
await mpv.waitFor((e) => e.event === 'file-loaded');
for (const name of ['current-tracks/audio/replaygain-track-gain', 'current-tracks/audio/replaygain-album-gain', 'current-tracks/audio/demux-samplerate', 'current-tracks/audio/codec', 'current-tracks/audio/audio-channels', 'replaygain']) {
  console.log(name, JSON.stringify(await mpv.get(name)));
}
console.log('current-tracks/audio', JSON.stringify(await mpv.get('current-tracks/audio')));
await mpv.quit();
