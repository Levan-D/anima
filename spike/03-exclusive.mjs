/*
 * Real device, volume 0 (silent) but exclusive mode briefly mutes other apps.
 * Checks: exclusive at startup, runtime toggle, what a busy device looks like.
 */
import { startMpv, MUSIC, sleep } from './lib.mjs';

const OBSERVED = ['current-ao', 'audio-params', 'audio-out-params', 'audio-exclusive', 'volume'];
const LOUD = ['--volume=0', '--media-controls=no', '--ao=wasapi'];

async function snapshot(mpv, label) {
  console.log(label, JSON.stringify({
    ao: await mpv.get('current-ao'),
    exclusive: await mpv.get('audio-exclusive'),
    out: await mpv.get('audio-out-params'),
    pos: await mpv.get('time-pos'),
    pause: await mpv.get('pause'),
    coreIdle: await mpv.get('core-idle'),
  }));
}

async function withLogs(args) {
  const mpv = await startMpv([...LOUD, ...args]);
  await mpv.command('request_log_messages', 'info');
  let id = 1;
  for (const name of OBSERVED) await mpv.observe(id++, name);
  return mpv;
}

const relevant = (mpv) => mpv.events
  .filter((e) => (e.event === 'log-message' && /ao|cplayer/.test(e.prefix) && !/Set property|Run command/.test(e.text)) || e.event === 'end-file' || e.event === 'audio-reconfig')
  .map((e) => (e.event === 'log-message' ? `[${e.prefix}/${e.level}] ${e.text.trim()}` : `<${e.event}${e.reason ? `:${e.reason}` : ''}>`))
  .join('\n    ');

console.log('--- A. shared start');
const a = await withLogs([]);
await a.command('loadfile', MUSIC, 'replace', -1, 'start=60');
await a.waitFor((e) => e.event === 'playback-restart');
await sleep(800);
await snapshot(a, 'shared');
console.log('    ', relevant(a));

console.log('--- B. runtime toggle to exclusive: set audio-exclusive alone');
a.clearEvents();
await a.set('audio-exclusive', true);
await sleep(800);
await snapshot(a, 'after set only');
console.log('    ', relevant(a));

console.log('--- C. then ao-reload');
a.clearEvents();
const before = await a.get('time-pos');
const started = Date.now();
const reload = await a.command('ao-reload');
console.log('ao-reload reply', JSON.stringify(reload), 'took', Date.now() - started, 'ms');
await sleep(1000);
const after = await a.get('time-pos');
await snapshot(a, 'after ao-reload');
console.log('position before/after', before, after);
console.log('    ', relevant(a));

console.log('--- D. second instance while first holds exclusive');
const b = await withLogs(['--audio-fallback-to-null=no']);
await b.command('loadfile', MUSIC, 'replace', -1, 'start=60');
await sleep(2500);
await snapshot(b, 'second (shared) while first exclusive');
console.log('    ', relevant(b));
console.log('    all events', b.events.filter((e) => e.event !== 'log-message' && e.event !== 'property-change').map((e) => e.event + (e.reason ? `:${e.reason}` : '') + (e.file_error ? `:${e.file_error}` : '')).join(' > '));
await b.quit();

console.log('--- E. back to shared at runtime');
a.clearEvents();
await a.set('audio-exclusive', false);
await a.command('ao-reload');
await sleep(800);
await snapshot(a, 'back to shared');
console.log('    ', relevant(a));

console.log('--- F. exclusive start on second instance while first is shared (first keeps playing?)');
const c = await withLogs(['--audio-exclusive=yes']);
await c.command('loadfile', MUSIC, 'replace', -1, 'start=60');
await sleep(2000);
await snapshot(c, 'c exclusive');
await snapshot(a, 'a shared while c exclusive');
console.log('    c:', relevant(c));
console.log('    a events:', relevant(a));
await c.quit();
await sleep(500);
await a.quit();
console.log('done');
