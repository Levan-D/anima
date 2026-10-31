# Phase 0: mpv spike results (2026-10-30)

Scripts are in `spike/`. Build tested: official mpv v0.41.0 (`mpv-v0.41.0-x86_64-w64-mingw32.zip`, pinned by SHA-256 in `scripts/fetch-binaries.mjs`). Test tracks: `Nightwish/Human II Nature/Human/Music.flac` → `Noise.flac` (44.1 kHz, 16-bit).

## Verdict: option B holds, and is simpler than planned

| Question | Result | How it was checked |
| --- | --- | --- |
| Headless control over IPC | ✅ | Load, pause, seek, playlist moves, events |
| Gapless | ✅ **Byte-identical** across the boundary | Music's tail into Noise through mpv's PCM writer, compared with each track decoded alone. 440,999 stereo frames match, and nothing was inserted. Control run with `gapless-audio=no` fails, as it should |
| Exclusive mode | ✅ `AO: 44100Hz stereo s16` vs shared `48000Hz float` | Real device (Realtek), volume 0 |
| Toggle at runtime | ✅ `set_property audio-exclusive` alone reloads the output | `ao-reload` isn't needed |
| Device busy | ✅ Clean, catchable | `end-file` with `reason: error`, `file_error: "audio output initialization failed"`, then idle |
| Another app takes exclusive while shared | ✅ Same error, after `AUDCLNT_E_DEVICE_INVALIDATED` | Second mpv instance |
| Live EQ | ✅ `af-command` changes a running filter | Measured on a 1 kHz tone: exactly ±6.00 dB, and the jump at the change is the same size as `af set`. See below |
| App dies, mpv keeps the DAC | ✅ **Solved by design** | mpv exits within 1 ms of a force-kill of its parent. See below |
| Windows media overlay | ✅ Silent `<audio>` + Media Session | Read back through WinRT: title, artist, album, art, position, and pause/next/previous/stop reach the page's handlers |
| ReplayGain | ✅ `album` falls back to track gain | Measured −6.21 dB against a −6.21 dB tag. Also readable at `current-tracks/audio/replaygain-*` |

## What changed from the plan

**1. No named pipe, no heartbeat script.** mpv accepts `--input-ipc-client=fd://3`, and Node's `stdio: ['ignore', 'ignore', 'ignore', 'overlapped']` provides exactly the handle it needs. The app talks on `child.stdio[3]`, and when the app dies for any reason the connection closes and mpv quits. The orphan problem doesn't exist any more, there's no pipe name to collide with, and there's no leftover pipe to clean up on startup.

**2. mpv's own `--media-controls` doesn't work headless.** The option exists in 0.41, but no session appears without a window. Set `--media-controls=no` and use the Chromium route.

**3. Don't register media keys with `globalShortcut`.** Registering them returned true, but the app's overlay session then vanished, so overlay commands stopped reaching the page. Leave them unregistered: Windows routes hardware keys to the current media session, which is how the overlay buttons arrive too.

**4. The silent audio element.**
- Must be audible as far as Chromium knows: zero-sample audio and `volume = 0` both register. `muted = true` does **not** register a session.
- Must really be paused when playback pauses. If it keeps running, the overlay never offers Play.
- Fires `error` (`AUDIO_RENDERER_ERROR`) when mpv takes the device in exclusive mode. The session survives; recreate the element with backoff.

**5. `af-command` needs an explicit target to report success.** `af-command eq1 gain 6` applies the change but replies `error running command`, because it's sent to every filter in the wrapped graph. `af-command eq1 gain 6 Parsed_equalizer_0` replies `success`. `frequency`, `f`, `width`, `w` work the same way.

**6. Keep one filter per `lavfi` label.** The label plus target then addresses exactly one band: a change to a 100 Hz band moved a 1 kHz tone by only 0.16 dB, which is that band's own skirt.

## Protocol facts the docs leave open

- `loadfile` replies with `{"data":{"playlist_entry_id":N}}`, the same id as `start-file` and `end-file`.
- `observe_property` emits the current value right away.
- `time-pos` fires about 13 times per second while playing, in uneven steps of 50 to 200 ms. After pausing there may be one more or none, so nothing should count on it. Phase 3 has more of these in [research/mpv-ipc.md](research/mpv-ipc.md).
- Options must go in the fourth `loadfile` argument: `loadfile path replace -1 start=30,end=31`.
- Error replies: `property not found`, `invalid parameter`, `error running command`.
- Missing file: `end-file`, `reason: error`, `file_error: "loading failed"`. mpv then goes idle with the failed entry still counted in the playlist.
- Seeking past the end gives `end-file`, `reason: error`. Clamp seeks.
- `volume` is cubic: 50 is −18 dB, not −6 dB. 100 changes nothing, so the path stays untouched.
- `audio-params` is what was decoded and `audio-out-params` is what the device gets, which is how the app can tell whether output is bit-perfect.
- The Music file carries a 1500×1500 embedded cover, and mpv ignores it with `--vid=no`.

## Your library (read-only scan)

5,719 audio files (4,924 FLAC, 795 MP3), 151 GB, 393 top-level folders. Art is mostly embedded. Only 74 `folder.jpg` and a few `cover.*`. The 69 `AlbumArtSmall.jpg` and `AlbumArt_{…}_Small/Large.jpg` files are Windows Media Player leftovers and must be ignored. Two CUE files, one with gaps.

## Still needs you

I can't hear anything, and this machine's only output is Realtek speakers. So these are yours:
- [ ] Listen to Music → Noise through your DAC.
- [ ] Turn on exclusive mode with your DAC connected, and check its display shows the file's real sample rate.
- [ ] Press your real media keys. I didn't, because foobar2000 was running and would have reacted.
