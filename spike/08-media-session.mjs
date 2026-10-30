/*
 * Launches the Electron spike under each variant, reads the Windows media session
 * list, and sends actions only to that app's own session.
 */
import { spawn, execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { startMpv, sleep, MUSIC, ROOT } from './lib.mjs';

const ELECTRON = process.env.SPIKE_ELECTRON;
if (!ELECTRON || !existsSync(ELECTRON)) throw new Error('Set SPIKE_ELECTRON to electron.exe');

function smtc(action = '') {
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
$manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$current = $manager.GetCurrentSession()
foreach ($s in $manager.GetSessions()) {
  $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  $i = $s.GetPlaybackInfo(); $tl = $s.GetTimelineProperties()
  [pscustomobject]@{ app = $s.SourceAppUserModelId; isCurrent = ($current -and $current.SourceAppUserModelId -eq $s.SourceAppUserModelId); title = $p.Title; artist = $p.Artist; album = $p.AlbumTitle; hasThumb = ($null -ne $p.Thumbnail); status = "$($i.PlaybackStatus)"; canNext = $i.Controls.IsNextEnabled; canPrev = $i.Controls.IsPreviousEnabled; canSeek = $i.Controls.IsPlaybackPositionEnabled; position = "$($tl.Position)"; end = "$($tl.EndTime)" } | ConvertTo-Json -Compress
}
${action}
`;
  return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 30000 }).trim();
}
const SEND = (method) => `
foreach ($s in $manager.GetSessions()) {
  if ($s.SourceAppUserModelId -match 'musicplayer|electron') {
    $ok = Await ($s.${method}()) ([bool])
    Write-Output "sent ${method} to $($s.SourceAppUserModelId): $ok"
  }
}`;

function launch(variant, extra = []) {
  const child = spawn(ELECTRON, [join(ROOT, 'spike', '08-electron', 'main.cjs'), `--variant=${variant}`, ...extra], { stdio: ['ignore', 'pipe', 'pipe'] });
  const lines = [];
  const take = (d) => { for (const l of d.toString().split(/\r?\n/)) if (l.trim() && !/GPU|Autofill|DevTools|gpu_/.test(l)) lines.push(l.trim()); };
  child.stdout.on('data', take); child.stderr.on('data', take);
  return { child, lines };
}

const sessionsOf = (out) => out.split('\n').filter((l) => /musicplayer|electron/i.test(l));

for (const variant of ['zero-samples', 'volume-zero', 'muted']) {
  console.log(`\n=== variant ${variant}`);
  const { child, lines } = launch(variant);
  await sleep(3500);
  const out = smtc();
  console.log('sessions', sessionsOf(out).join('\n') || `(none of ours) all: ${out}`);
  console.log('page', lines.slice(-6).join(' | '));
  child.kill();
  await sleep(700);
}

console.log('\n=== actions, zero-samples');
{
  const { child, lines } = launch('zero-samples', ['--register-keys']);
  await sleep(3500);
  console.log(smtc(SEND('TryTogglePlayPauseAsync')).split('\n').filter((l) => /sent/.test(l)).join('\n'));
  await sleep(500);
  console.log(smtc(SEND('TrySkipNextAsync')).split('\n').filter((l) => /sent/.test(l)).join('\n'));
  await sleep(500);
  console.log(smtc(SEND('TrySkipPreviousAsync')).split('\n').filter((l) => /sent/.test(l)).join('\n'));
  await sleep(500);
  console.log(lines.filter((l) => /ACTION|globalShortcut|KEY/.test(l)).join('\n'));
  child.kill();
  await sleep(700);
}

console.log('\n=== while mpv holds the device in exclusive mode');
{
  const mpv = await startMpv(['--volume=0', '--ao=wasapi', '--media-controls=no', '--audio-exclusive=yes']);
  await mpv.command('loadfile', MUSIC, 'replace', -1, 'start=60');
  await mpv.waitFor((e) => e.event === 'playback-restart');
  await sleep(500);
  console.log('mpv out', JSON.stringify(await mpv.get('audio-out-params')));
  const { child, lines } = launch('zero-samples');
  await sleep(4000);
  console.log('sessions', sessionsOf(smtc()).join('\n') || '(none of ours)');
  console.log('page', lines.slice(-6).join(' | '));
  console.log('mpv still playing', await mpv.get('core-idle'), await mpv.get('current-ao'));
  child.kill();
  await sleep(300);
  await mpv.quit();
}

console.log('\n=== app already running shared, then mpv takes exclusive');
{
  const { child, lines } = launch('zero-samples');
  await sleep(3000);
  console.log('before', sessionsOf(smtc()).join('\n') || '(none of ours)');
  const mpv = await startMpv(['--volume=0', '--ao=wasapi', '--media-controls=no', '--audio-exclusive=yes']);
  await mpv.command('loadfile', MUSIC, 'replace', -1, 'start=60');
  await mpv.waitFor((e) => e.event === 'playback-restart');
  await sleep(3000);
  console.log('after', sessionsOf(smtc()).join('\n') || '(none of ours)');
  console.log('page', lines.slice(-6).join(' | '));
  console.log('mpv ao', await mpv.get('current-ao'), JSON.stringify(await mpv.get('audio-out-params')));
  await mpv.quit();
  child.kill();
}
console.log('\ndone');
