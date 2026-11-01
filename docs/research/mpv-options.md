# mpv manual (stable): options and audio behavior

## Sources
- https://mpv.io/manual/stable/ (read at character offsets 0, 39429, 139429, 178858, 218287, 298858, 398287, 445000 and 478287 of 646,413). Text from these reads is verbatim unless marked [S].
- https://mpv.io/manual/master/ was not fetched, so anything documented only on master is unchecked.

Conventions: [S] means the fetch tool's model-extracted summary of a region it did not return verbatim. Treat those items as lower confidence. "Not stated" means the text read gives no default.

## Audio output selection
- `--ao=<driver1,driver2,...[,]>`: priority list. A trailing comma lets mpv fall back to unlisted drivers. The default order is not documented ("subject to change, and must not be relied upon"). `--ao=help` lists compiled-in drivers in autoprobe order.
- `--audio-device=<ao>/<device>`: default `auto`, which tries each AO in preference order with its default device. `--audio-device=help` lists devices. The `audio-device-list` property returns them. Do not combine `--ao` with `--audio-device`, because `--ao` strictly forces one AO.
- `--audio-fallback-to-null=<yes|no>`: if no device opens, behave as `--ao=null`. Default not stated. Intended for embedders, who can check `current-ao` and `audio-device-list`.
- `--audio-exclusive=<yes|no>`: exclusive mode, which locks out the system mixer. Documented for wasapi, coreaudio, pipewire and audiounit ("such as"). Other outputs silently ignore it. Default not stated.
- `--audio-client-name=<name>`: application name reported to the audio API. Default not stated.
- `--audio-buffer=<seconds>`: minimum AO buffer, default 0.2 (200 ms). The manual says it "should be used for testing only."
- `--audio-wait-open=<secs>`: waits after opening the device before sending audio. Only meaningful with `--audio-stream-silence=yes`. Default not stated.
- `--audio-stream-silence=<yes|no>`: keeps the device open across seeks and pauses and fills with silence. Not all AOs support it, and the manual calls it "strongly discouraged." Default not stated.
- Other AOs listed: alsa, oss, jack, coreaudio and coreaudio_exclusive (macOS), avfoundation (macOS), audiounit (iOS), openal, pulse, pipewire, sdl, null, pcm, sndio, wasapi.

wasapi:
- The only documented wasapi option is `--wasapi-exclusive-buffer=<default|min|1-2000000>` (microseconds). It applies with `--audio-exclusive=yes`. `default` and `min` use the device's default or minimum period. Shorter values round up to the minimum. The manual notes glitches after stream resets on some devices, where a shorter value may help.
- No wasapi device-name or client-name option is documented.

pcm (`--ao=pcm`):
- `--ao-pcm-waveheader=<yes|no>`: default included. `no` writes raw PCM.
- `--ao-pcm-file=<filename>`: default `audiodump.wav`, or `audiodump.pcm` with no-waveheader.
- `--ao-pcm-append=<yes|no>`: overwrites by default (default not stated; measured: every time the output opens, so a run that goes idle starts its file over). Use with no-waveheader, because a header would be rewritten on every open.

null (`--ao=null`):
- Produces no output but keeps video timing. Options: `--ao-null-untimed` (decode as fast as possible, suggested for benchmarking), `--ao-null-buffer`, `--ao-null-outburst`, `--ao-null-speed`, `--ao-null-latency`, `--ao-null-broken-eof`, `--ao-null-broken-delay`, `--ao-null-channel-layouts`, and `--ao-null-format` (unset accepts any format). No defaults are given.
- To disable video, the manual prefers `--video=no` over `--vo=null`.

## Gapless and prefetch
- `--gapless-audio=<no|yes|weak>`, default `weak`.
  - `no`: disabled.
  - `yes`: the device is opened with the first file's parameters and kept open. Later files with other rates may be resampled to that rate. Fix the shared format with `--audio-samplerate` and `--audio-format`.
  - `weak`: the device stays open in the format it was first initialized with. It is closed and reopened when the decoder output format changes. It survives sample-format changes if the formats are convertible. Gapless is abandoned while video is still playing.
  - Caveat: gapless relies on AO buffering. A slow start (network, cache fill) can run out of buffered audio.
  - Measured: setting `no` at runtime after an `af` change reopens the output mid-file, at the first frame in the new format, not at the file's end. Going idle closes the output after playing out what it has (`player.reopen.bytes.test.ts`).
- `--prefetch-playlist=<yes|no>`, default `no`. It opens the next entry's URL as soon as the current one is fully read. It does not work for URLs resolved by the youtube-dl wrapper. HLS (.m3u8) streams are not affected, and their prefetch is on by default. It can mispredict if the user goes backward.

## ReplayGain
- `--replaygain=<no|track|album>`, default `no`. `track` applies track gain. `album` applies album gain if present and otherwise falls back to track gain.
- With no replaygain tags at all, `--replaygain-fallback=<db>` is applied (default not stated). When it applies, no other replaygain options are applied, including preamp and clip.
- `--replaygain-preamp=<db>`, default 0.
- `--replaygain-clip=<yes|no>`, default `no`. When `no`, mpv lowers the gain to prevent clipping.
- Measured, and matching `decode_rgain` in `demux/demux.c`: a track gain is what makes any of it apply, so an album gain alone is ignored. A missing peak counts as 1, so a boost with no peak tag applies nothing. An unreadable peak loses the gain beside it. Album falls back to track only when its gain is missing. See [audio-verification.md](audio-verification.md).

## Volume, mute, format, channels
- `--volume=<value>`: startup volume. 0 is silence, 100 is no change, and negatives are treated as 0. Since mpv 0.18.1 it always controls the internal mixer (software volume). Default not stated.
- `--volume-max=<100.0-1000.0>`, default 130 (percent).
- `--volume-gain=<db>`: applied on top of other volume and gain settings. `--volume-gain-min=<-150.0-0.0>` defaults to -96 dB, and `--volume-gain-max=<0.0-150.0>` defaults to 12 dB.
- `--mute=<yes|no>`, default `no`. Sets the startup mute state.
- `softvol`: no `--softvol` option appears in the text read.
- `ao-volume`: a runtime property referenced by the AO notes (alsa mixer, `--pipewire-volume-mode=<channel|global>`). Its own definition was not read.
- Volume and other changed options persist: the resume section says options changed after playback began, such as volume, are restored next time, and `--watch-later-options` controls which ones.
- `--audio-pitch-correction=<yes|no>`, default `yes`. A speed change inserts `scaletempo2`. The Audio section says "speed different from normal," while the `--speed` entry says "higher than normal." `--pitch` also inserts it. You can override the filter with a conditional auto profile.
- `--audio-samplerate=<Hz>`: output rate. A mismatch with the media inserts swresample.
- `--audio-format=<format>`: sample format from the filter layer to the device. The manual points to the `format` audio filter, which says to run `--af=format=format=help`. The value list was not read.
- `--audio-channels=<auto-safe|auto|layouts>`, default `auto-safe` (system preferred layout, forced to stereo if none). `auto` sends whatever the device accepts, with an HDMI warning. A layout list such as `7.1,5.1,stereo` acts as a whitelist. `stereo` and `mono` force a downmix.

## Track selection
- `--vid=<ID|auto|no>` (alias `--video`): `--vid=no` or `--video=no` disables video. No separate `--no-video` option is documented in the text read.
- `--aid=<ID|auto|no>` (alias `--audio`): `--aid=no` or `--audio=no` disables audio. Since mpv 0.33.0, a track selection that points at a missing track resets to `auto`.

## Window, idle, keep-open, cover art
- `--audio-display=<no|embedded-first|external-first>`, default `embedded-first`. "Disable display of video entirely when playing audio files" is the text for `no`. It has no effect on files with normal video tracks.
- `--audio-file-auto=<no|exact|fuzzy|all>`, default `no`. `exact` loads files matching the video name with an audio extension. `fuzzy` loads any file containing that name. `all` loads all audio in the current and `--audio-file-paths` directories.
- `--cover-art-auto`: not found in the text read verbatim. A summary of a region it did not return verbatim said it was absent. Not settled.
- `--force-window=<yes|no|immediate>`: creates a video output window even with no video. The window is 960x540 and subject to `--geometry` and `--autofit`. It is created after initialization, and `immediate` creates it at startup. Default not stated. The pseudo-GUI profile sets `yes`.
- `--keep-open=<no|yes|always>`, default `no`. `yes` pauses instead of terminating at the end of the last playlist entry. `always` also applies to earlier entries. It is not respected with `--frames`. `--keep-open-pause=<yes|no>`, default `yes`.
- `--idle=<no|yes|once>`, default `no` [S]. Waits when there is nothing to play. `once` idles only at startup.
- `--osc=<yes|no>`, default `yes`. Loads the on-screen controller.
- Pseudo-GUI mode (Windows): it is triggered when mpv is started from explorer.exe, which the manual defines as started on Windows with stdout, stderr and stdin all unset. It also runs on `--player-operation-mode=pseudo-gui`. It applies the `builtin-pseudo-gui` profile: `terminal=no`, `force-window=yes`, `idle=once`, `screenshot-directory=~~desktop/`. These apply only to options not already set in config or on the command line.

For a headless audio player, the documented levers are `--vid=no` (no video), `--audio-display=no` (no cover art), `--audio-file-auto=no` (the default), and leaving `--force-window` at its default. The manual implies a window appears only with video, unless `--force-window` is set.

## Input and IPC
- `--input-default-bindings=<yes|no>`, default `yes`. The manual notes it is disabled by default in libmpv.
- `--input-vo-keyboard=<yes|no>`: disables keyboard input for VOs that cannot dispatch keys properly. "Generally useful for embedding only." Default not stated.
- `--input-media-keys=<yes|no>`, default `yes` (except for libmpv). It only applies on macOS and Windows. Whether media keys work while the mpv window is focused is "implementation-defined."
- `--input-ipc-server=<path>`: on Windows the path is a named pipe in the `\\.\pipe\<name>` namespace. mpv adds the `\\.\pipe\` prefix if it is missing. The manual calls the IPC protocol "not 'secure'" and not intended to be.
- `--input-terminal=<yes|no>`: automatically enabled when `-` appears on the command line. Set it manually for `/dev/stdin`, stdin inside a playlist, or later `loadfile` from stdin. Default not stated.
- `--input-ar-delay` defaults to 200 ms. `--input-ar-rate` defaults to 40 presses per second.
- `--media-controls`: the Input section, read verbatim, has no such option. Master was not read. Its existence, Windows behavior and version are not settled by the docs read.
- `--terminal`: [S] `--terminal=no` disables use of the terminal and stdin/stdout/stderr. The verbatim text notes that `--terminal=no` or `--really-quiet` help when TCT output is out of sync.
- `--msg-level`: [S] takes `module=level` pairs, default `status`. Verbatim usage example: `--msg-level=vo=trace`.
- `--log-file=<path>` [S]: writes the log and truncates an existing file. The minimum verbosity is `-v -v`. Since mpv 0.31.0 the value must follow `=`, so `--log-file f.txt` now fails.
- Advice for programs that run mpv (verbatim): do not parse terminal output, make sure the code works with `--terminal=no`, and consider `--no-config` or `--config-dir` to avoid conflicts with user config. IPC via `--input-ipc-server` or `--input-ipc-client` is recommended.

## Config and scripts (all [S])
- `--no-config`: a flag. It skips the user and system `mpv.conf` and `input.conf` and other user files. It is effective only on the command line.
- `--config-dir=<path>`: forces a single config directory. `--no-config` takes precedence if both are given. Verbatim: with `--no-config`, `~~/`, `~~home/` and `~~global/` expand to empty strings.
- `--include=<file>`: parsed after the default configs.
- No `--config` option appears in the text read. Use `--config-dir` or `--include`.
- `--load-scripts=<yes|no>`, default `yes`.
- `--script=<file>`, and `--scripts=a:b` (separator `;` on Windows).

## Start, end, length and per-file options
- `--start=<relative time>`: format `[+|-][[hh:]mm:]ss[.ms]`. A leading `-` counts from the end. `pp%` seeks to a percentage, `#c` to a chapter, and `none` clears it. A plus sign is ignored unless `--rebase-start-time=no`. Example from the manual: `--start=30 --end=40` plays 10 seconds.
- `--end=<relative time>`: stop time. `--length=<relative time>`: duration from the start. If both are set, playback stops at whichever comes first. `--rebase-start-time=<yes|no>` defaults to `yes`.
- Per-file rules: options on the command line apply to all files. `--{` and `--}` mark per-file blocks. Options changed at runtime are not reset when the next file plays, but file-local options are reset when their file stops. So to move where the playing file stops, set `file-local-options/end`: a plain `end` carries over to the files after it (measured).
- `loadfile <url> [<flags> [<index> [<options>]]]`:
  - Flags: `replace` (default), `append`, `append-play`, `insert-next`, `insert-next-play`, `insert-at`, `insert-at-play`.
  - The index (third argument) is used only by `insert-at` and `insert-at-play`. A negative or out-of-range index appends. It was added in mpv 0.38.0.
  - The options (fourth argument) take the form `opt1=value1,opt2=value2,...`. They are set during playback and restored afterwards. Through the client API the values must be strings.
  - Since 0.38.0, the index must be `-1` when the options argument is used.

## Audio filters (af)
- `--af=<filter1[=p1:p2:...],filter2,...>`: an object settings list. The manual says `--af` "See --vf for the full syntax." `--af-add`, `--af-pre` and `--af-clr` exist but are rarely needed. `--af=help` lists filters.
- Entry grammar, from the video-filter section that the audio section says applies to `--af`: `["@"<label>":"] ["!"] <filter-name> ["=" <params>]`. The toggle form is `"@"<label>`. Parameters are separated by `:`, not `,`. Values containing `,` or `=` are quoted with `[...]`. A leading `!` disables the filter at creation. Labels let runtime commands target a filter.
- `--af` accepts one track as input. Filters that need several inputs must go through `--lavfi-complex`.
- lavfi wrapper (audio): `lavfi=<graph>` runs an FFmpeg libavfilter graph. Options are `o=<AVOptions>` and `fix-pts=<yes|no>`, default `no`. Quote the graph. The video section's example is `--vf=lavfi=[gradfun=20:30,vflip]`.
- Labels: the docs show labels only in video examples: `vf-add=@rot:rotate=PI/2` and `vf-remove=@rot`. `@name:lavfi=[...]` follows the grammar above, but no audio example is given.
- `scaletempo2` defaults: `min-speed=0.25` (mutes below), `max-speed=8.0` (mutes above, and 0 disables that limit), `search-interval=40` ms, `window-size=12` ms. It is inserted automatically by `--audio-pitch-correction`.
- `scaletempo` defaults: `scale=1.0`, `stride=60` ms, `overlap=.20`, `search=14` ms, `speed=tempo` (other values: `pitch`, `both`, `none`).
- `rubberband`: `pitch-scale=1.0`. `engine=faster|finer`, where finer (R3) is the default if available. Runtime `af-command` verbs are `set-pitch` and `multiply-pitch`.
- `format=format:srate:channels:out-srate:out-channels` forces a conversion. `--af=format=format=help` lists formats. The old name was `force`.
- `drop` is used automatically with `--video-sync=display-adrop`. The manual says not to use it.
- [S] Runtime commands: `af <operation> <value>` ("Change audio filter chain"), and `af-command <label> <command> <arg> [<target>]`. Their set, add, toggle, remove and clr semantics mirror `vf`.

## Not settled by docs or not read
- `--media-controls`: absent from the stable Input section. Master was not checked, so its existence, Windows behavior and version are unknown.
- `--cover-art-auto`: not located verbatim.
- `--audio-format` value list: not in the text read. It is generated by `--af=format=format=help`.
- `--softvol`: not documented in the text read.
- Default AO order: not documented.
- Defaults not stated: `--audio-exclusive`, `--audio-fallback-to-null`, `--audio-client-name`, `--audio-wait-open`, `--audio-stream-silence`, `--volume`, `--replaygain-fallback`, `--force-window`, `--input-vo-keyboard`, `--input-terminal`, `--ao-pcm-append`.
- Only summary-level ([S]): `--idle`, `--no-config`, `--config-dir`, `--include`, `--log-file`, `--msg-level`, `--terminal`, `--load-scripts`, `--script`, and the `af` runtime commands. The Program Behavior and Video regions were not read verbatim.
- `ao-volume` property definition, and JSON IPC protocol details beyond the option text.
- Versions: master not checked. Version notes in the stable text: 0.18.1 (volume), 0.31.0 (`=` syntax for options), 0.33.0 (track selection), 0.38.0 (loadfile index). The stable manual's own version number is not stated in the text read.

## Gotchas
- `--ao` and `--audio-device` conflict.
- Replaygain fallback suppresses other replaygain options.
- `--audio-stream-silence` is discouraged, and `--audio-buffer` is for testing.
- Volume persists to watch-later files.
- Options must use `=` since 0.31.0.
- Explorer launch triggers pseudo-GUI mode, which sets `force-window=yes` and `idle=once`.
- The speed wording differs between the Audio and `--speed` entries.
