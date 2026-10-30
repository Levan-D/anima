/* Silent. Checks the IPC protocol facts the docs leave open. */
import { startMpv, MUSIC, NOISE, sleep } from './lib.mjs';

const mpv = await startMpv(['--ao=null', '--media-controls=no']);
console.log('version', await mpv.get('mpv-version'));
const unknown = await mpv.command('get_property', 'not-a-real-property');
console.log('unknown property reply', JSON.stringify(unknown));
const badCommand = await mpv.command('not-a-real-command');
console.log('unknown command reply', JSON.stringify(badCommand));
for (const [id, name] of [[1, 'time-pos'], [2, 'pause'], [3, 'path'], [4, 'duration'], [5, 'playlist-pos'], [6, 'idle-active'], [7, 'audio-params'], [8, 'audio-out-params'], [9, 'current-ao'], [10, 'seeking'], [11, 'core-idle']]) await mpv.observe(id, name);
await sleep(100);
console.log('events right after observe (does observe emit initial values?)', mpv.events.filter((e) => e.event === 'property-change').map((e) => `${e.name}=${JSON.stringify(e.data)}`).join(' | '));
mpv.clearEvents();

const first = await mpv.command('loadfile', MUSIC, 'replace');
console.log('loadfile replace reply', JSON.stringify(first));
const second = await mpv.command('loadfile', NOISE, 'append');
console.log('loadfile append reply', JSON.stringify(second));
await mpv.waitFor((e) => e.event === 'file-loaded');
console.log('order to file-loaded', mpv.events.map((e) => e.event === 'property-change' ? `${e.name}` : e.event).join(' > '));
console.log('start-file', JSON.stringify(mpv.events.find((e) => e.event === 'start-file')));

await new Promise((ok) => setTimeout(ok, 3000));
const ticks = mpv.events.filter((e) => e.name === 'time-pos');
if (ticks.length > 1) {
  const spanMs = ticks.at(-1).t - ticks[0].t;
  console.log(`time-pos: ${ticks.length} events in ${spanMs}ms = ${(ticks.length / (spanMs / 1000)).toFixed(1)}/s, resolution sample ${ticks.slice(-3).map((t) => t.data).join(', ')}`);
}
console.log('audio-params', JSON.stringify(await mpv.get('audio-params')));
console.log('audio-out-params', JSON.stringify(await mpv.get('audio-out-params')));
console.log('metadata keys', JSON.stringify(await mpv.get('metadata')));

mpv.clearEvents();
const seekReply = await mpv.command('seek', 100, 'absolute');
console.log('seek reply', JSON.stringify(seekReply));
await mpv.waitFor((e) => e.event === 'playback-restart');
console.log('seek order', mpv.events.map((e) => e.event === 'property-change' ? `${e.name}=${e.data}` : e.event).slice(0, 8).join(' > '));

mpv.clearEvents();
await mpv.set('pause', true);
await sleep(300);
const pausedTicks = mpv.events.filter((e) => e.name === 'time-pos').length;
console.log('pause events', mpv.events.map((e) => `${e.name}=${e.data}`).join(' '), 'time-pos ticks while paused', pausedTicks);
await mpv.set('pause', false);

console.log('--- playlist navigation window');
mpv.clearEvents();
await mpv.command('playlist-next');
await mpv.waitFor((e) => e.event === 'file-loaded');
console.log('playlist', JSON.stringify(await mpv.get('playlist')));
mpv.clearEvents();
const prev = await mpv.command('playlist-prev');
console.log('playlist-prev reply', JSON.stringify(prev));
await mpv.waitFor((e) => e.event === 'file-loaded');
await sleep(300);
console.log('prev events', mpv.events.filter((e) => e.event !== 'property-change').map((e) => JSON.stringify(e)).join('\n  '));
console.log('playlist after prev', JSON.stringify(await mpv.get('playlist')));

console.log('--- missing file');
mpv.clearEvents();
const missing = await mpv.command('loadfile', 'D:\\Music\\does-not-exist.flac', 'replace');
console.log('missing loadfile reply', JSON.stringify(missing));
await mpv.waitFor((e) => e.event === 'end-file' && e.reason === 'error', 5000, 'error end-file');
await sleep(300);
console.log('missing events', mpv.events.filter((e) => e.event !== 'property-change').map((e) => JSON.stringify(e)).join('\n  '));
console.log('state after missing: idle-active', await mpv.get('idle-active'), 'playlist-count', await mpv.get('playlist-count'));

console.log('--- per-file options');
mpv.clearEvents();
const clip = await mpv.command('loadfile', MUSIC, 'replace', -1, 'start=30,end=31');
console.log('per-file reply', JSON.stringify(clip));
await mpv.waitFor((e) => e.event === 'end-file' && e.reason === 'eof', 8000, 'eof');
const pos = mpv.events.filter((e) => e.name === 'time-pos').map((e) => e.data).filter((v) => v !== null);
console.log('per-file time-pos first/last', pos[0], pos.at(-1), 'reason', mpv.events.find((e) => e.event === 'end-file').reason);

console.log('--- out-of-range seek');
mpv.clearEvents();
await mpv.command('loadfile', MUSIC, 'replace');
await mpv.waitFor((e) => e.event === 'file-loaded');
console.log('seek past end reply', JSON.stringify(await mpv.command('seek', 99999, 'absolute')));
await sleep(800);
console.log('after seek past end', mpv.events.filter((e) => e.event !== 'property-change').map((e) => `${e.event}:${e.reason ?? ''}`).join(' > '));
await mpv.quit();
console.log('quit clean');
