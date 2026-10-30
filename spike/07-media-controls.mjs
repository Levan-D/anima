/*
 * Real device at volume 0. Does mpv's --media-controls register with the Windows
 * media overlay (SMTC) when running headless? Reads the session list through WinRT
 * and sends play/pause and next to mpv's session only, not to any other app.
 */
import { execFileSync } from 'node:child_process';
import { startMpv, MUSIC, NOISE, sleep } from './lib.mjs';

function smtc(action) {
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
  $i = $s.GetPlaybackInfo()
  $tl = $s.GetTimelineProperties()
  [pscustomobject]@{ app = $s.SourceAppUserModelId; isCurrent = ($current -and $current.SourceAppUserModelId -eq $s.SourceAppUserModelId); title = $p.Title; artist = $p.Artist; album = $p.AlbumTitle; hasThumb = ($null -ne $p.Thumbnail); status = "$($i.PlaybackStatus)"; canNext = $i.Controls.IsNextEnabled; canPrev = $i.Controls.IsPreviousEnabled; canSeek = $i.Controls.IsPlaybackPositionEnabled; position = "$($tl.Position)"; end = "$($tl.EndTime)" } | ConvertTo-Json -Compress
}
${action}
`;
  return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 30000 }).trim();
}

const SEND = (method) => `
foreach ($s in $manager.GetSessions()) {
  if ($s.SourceAppUserModelId -match 'mpv') {
    $ok = Await ($s.${method}()) ([bool])
    Write-Output "sent ${method} to $($s.SourceAppUserModelId): $ok"
  }
}`;

console.log('--- before mpv');
console.log(smtc(''));

const mpv = await startMpv(['--volume=0', '--ao=wasapi', '--media-controls=yes']);
for (const [i, name] of ['pause', 'playlist-pos', 'time-pos', 'media-title'].entries()) await mpv.observe(i + 1, name);
await mpv.command('loadfile', MUSIC, 'replace', -1, 'start=60');
await mpv.command('loadfile', NOISE, 'append');
await mpv.waitFor((e) => e.event === 'playback-restart');
await sleep(2000);

console.log('--- while mpv plays (media-controls=yes)');
console.log(smtc(''));

mpv.clearEvents();
console.log('--- toggle pause through SMTC');
console.log(smtc(SEND('TryTogglePlayPauseAsync')));
await sleep(800);
console.log('mpv saw', mpv.events.filter((e) => e.name === 'pause').map((e) => `pause=${e.data}`).join(' '));
mpv.clearEvents();
console.log(smtc(SEND('TryTogglePlayPauseAsync')));
await sleep(800);
console.log('mpv saw', mpv.events.filter((e) => e.name === 'pause').map((e) => `pause=${e.data}`).join(' '));

mpv.clearEvents();
console.log('--- next through SMTC');
console.log(smtc(SEND('TrySkipNextAsync')));
await sleep(1200);
console.log('mpv saw', mpv.events.filter((e) => e.event === 'start-file' || e.event === 'end-file' || e.name === 'playlist-pos').map((e) => e.event === 'property-change' ? `${e.name}=${e.data}` : `${e.event}:${e.reason ?? ''}`).join(' > '));
console.log(smtc(''));

mpv.clearEvents();
console.log('--- previous through SMTC');
console.log(smtc(SEND('TrySkipPreviousAsync')));
await sleep(1200);
console.log('mpv saw', mpv.events.filter((e) => e.event === 'start-file' || e.event === 'end-file' || e.name === 'playlist-pos').map((e) => e.event === 'property-change' ? `${e.name}=${e.data}` : `${e.event}:${e.reason ?? ''}`).join(' > '));

await mpv.quit();
await sleep(500);
console.log('--- after quit');
console.log(smtc(''));
