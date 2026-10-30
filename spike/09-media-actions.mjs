/* Do overlay buttons reach the page's Media Session handlers? Targets only this app's session. */
import { spawn, execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { sleep, ROOT } from './lib.mjs';

const ELECTRON = process.env.SPIKE_ELECTRON;

function smtc(action = '') {
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
foreach ($s in $manager.GetSessions()) {
  if ($s.SourceAppUserModelId -match 'musicplayer') {
    ${action}
  }
}
`;
  return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 30000 }).trim();
}
const send = (method, arg = '') => smtc(`$ok = Await ($s.${method}(${arg})) ([bool]); Write-Output "sent ${method}: $ok"`);

const child = spawn(ELECTRON, [join(ROOT, 'spike', '08-electron', 'main.cjs'), '--variant=zero-samples'], { stdio: ['ignore', 'pipe', 'pipe'] });
const lines = [];
const take = (d) => { for (const l of d.toString().split(/\r?\n/)) if (/ACTION|audio event/.test(l)) lines.push(l.trim()); };
child.stdout.on('data', take); child.stderr.on('data', take);
await sleep(3500);

for (const [method, arg] of [['TryTogglePlayPauseAsync'], ['TryPauseAsync'], ['TryPlayAsync'], ['TrySkipNextAsync'], ['TrySkipPreviousAsync'], ['TryStopAsync'], ['TryChangePlaybackPositionAsync', '[long]1200000000']]) {
  console.log(send(method, arg));
  await sleep(400);
  console.log('  page saw:', lines.splice(0).join(' | ') || '(nothing)');
}
child.kill();
