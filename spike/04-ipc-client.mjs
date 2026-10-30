/*
 * Silent. Can the app talk to mpv over an inherited stdio handle instead of a
 * named pipe, so mpv dies with the app? The docs say mpv quits when an
 * --input-ipc-client connection closes. Node's 'overlapped' stdio gives the
 * child an overlapped handle via the CRT fd table.
 */
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MPV, HEADLESS, sleep } from './lib.mjs';

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

if (process.argv[2] === 'child') {
  // Middleman: spawns mpv, reports its pid, then waits to be force-killed.
  const mpv = spawn(MPV, [...HEADLESS, '--ao=null', '--media-controls=no', '--input-ipc-client=fd://3'], {
    stdio: ['ignore', 'ignore', 'ignore', 'overlapped'],
    windowsHide: true,
  });
  const socket = mpv.stdio[3];
  let got = '';
  socket.setEncoding('utf8');
  socket.on('data', (d) => {
    got += d;
    if (got.includes('"request_id":1')) {
      console.log(`PID ${mpv.pid}`);
      console.log(`REPLY ${got.trim().split('\n').find((l) => l.includes('request_id'))}`);
    }
  });
  socket.write(`${JSON.stringify({ command: ['get_property', 'mpv-version'], request_id: 1 })}\n`);
  setInterval(() => {}, 1000);
} else {
  const self = fileURLToPath(import.meta.url);
  const middleman = spawn(process.execPath, [self, 'child'], { stdio: ['ignore', 'pipe', 'inherit'] });
  let output = '';
  middleman.stdout.setEncoding('utf8');
  middleman.stdout.on('data', (d) => { output += d; });
  const started = Date.now();
  while (!/PID \d+/.test(output) || !/REPLY/.test(output)) {
    if (Date.now() - started > 8000) {
      console.log('NO REPLY over inherited handle. Output:', output);
      middleman.kill();
      process.exit(1);
    }
    await sleep(50);
  }
  console.log(output.trim());
  const pid = Number(/PID (\d+)/.exec(output)[1]);
  console.log('mpv alive before killing the parent:', isAlive(pid));
  execFileSync('taskkill', ['/F', '/PID', String(middleman.pid)], { stdio: 'ignore' });
  const killedAt = Date.now();
  while (isAlive(pid) && Date.now() - killedAt < 5000) await sleep(20);
  console.log(`mpv alive after force-killing the parent: ${isAlive(pid)} (waited ${Date.now() - killedAt} ms)`);
  if (isAlive(pid)) process.kill(pid);
}
