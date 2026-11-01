# mpv reference notes: JSON IPC, commands, properties, events, Windows builds

## Sources
- https://mpv.io/manual/stable/#json-ipc (fragment fetch, same document; JSON IPC was not reached, see Caveats)
- https://mpv.io/manual/stable/ (read at offsets 0, 139420, 215000, 278840, 418260, 495000, 533000, 557680, 597109, 636538)
- https://mpv.io/installation/
- https://github.com/mpv-player/mpv (repo README)
- https://github.com/mpv-player/mpv/tree/master/DOCS
- https://github.com/mpv-player/mpv/tree/master/DOCS/man
- https://github.com/mpv-player/mpv/blob/master/DOCS/man/ipc.rst
- https://github.com/mpv-player/mpv/blob/master/DOCS/man/lua.rst

## Caveats
- The mpv.io manual text stops at 646,413 characters, inside `option-info/<name>/min`. JSON IPC, Lua scripting and Property Expansion were not reached there, so the JSON IPC and Lua notes come from the repo source (master branch). The stable manual may differ.
- No current release number appears in the pages read. "Since" notes are the docs' own. Check the `mpv-version` property at runtime.
- Not read: the `--pause` option entry, the FILES section (Windows config and scripts paths), Property Expansion.

## JSON IPC (DOCS/man/ipc.rst)

### Enabling, pipe path, security
- `--input-ipc-server=<filename>` enables IPC and creates a listening socket at that path. On Windows the path is in the pipe namespace, `\\.\pipe\<name>`. If the `\\.\pipe\` prefix is missing, mpv adds it. Docs say `--input-ipc-server=/tmp/mpv-socket` and `--input-ipc-server=\\.\pipe\tmp\mpv-socket` are equivalent on Windows.
- Doc example: `mpv file.mkv --input-ipc-server=\\.\pipe\mpvsocket`.
- `--input-ipc-client=fd://<N>`: one client over an inherited FD, no listening socket. On Windows the FD must wrap an already-connected named-pipe server handle that is duplex, overlapped and inheritable (created via `_open_osfhandle`). mpv quits when that connection closes. Writing `input-ipc-server` at runtime also starts a handler for `input-ipc-client` (docs call this a bug).
- No authentication, no encryption. The `run` command is exposed, so any client can start programs. Local control only.
- Windows testing: `echo ... >\\.\pipe\name` can send but cannot read replies. Reading needs an overlapped-I/O client (docs suggest .NET NamedPipeClientStream).
- To keep mpv running with no file, use `--idle`. With `--idle`, `playlist-play-index none` or writing `playlist-pos` -1 enters idle mode; without it, mpv exits.
- Headless: don't parse terminal output or feed keys through stdin; code should work with `--terminal=no`; `--no-config` or `--config-dir` avoids the user's config. For audio-only use, `--video=no` is preferred over `--vo=null`. `--audio-fallback-to-null=yes` makes a missing audio device behave like `--ao=null`; check `current-ao` and `audio-device-list`.

### Framing and requests
- One UTF-8 JSON object per line, terminated by `\n`. No `\n` may appear inside a message, so minify.
- Request: `{ "command": ["name", arg, ...] }`. Args are native JSON values (integers, strings, booleans).
- If `command` is an object, named arguments are used. Only commands listed in List of Input Commands accept them.
- A line whose first non-space character is not `{` is run as input.conf-style text. Text commands get no reply. Lines starting with `#` and blank lines are ignored.
- Send characters U+0020 and above as raw UTF-8. `\u` escapes that form surrogate pairs are not allowed. mpv can emit invalid UTF-8, so sanitize before parsing. An embedded NUL ends a line (don't rely on it).
- mpv accepts non-standard input (trailing commas, unquoted keys, `=` as separator, `\xAB` escapes). Don't generate these.

### Replies, request_id, async
- Reply: `{ "error": "success", "data": <value or null> }`, plus `request_id` if one was sent. The docs show only the `success` error string.
- `request_id`: optional integer in -2^63..2^63-1, echoed back verbatim, otherwise unused. Non-integer ids are deprecated (warning now, error later). Docs say replies get `request_id` 0 when none was sent, but several examples omit the field.
- Example: `{ "command": ["get_property", "time-pos"], "request_id": 100 }` returns `{ "error": "success", "data": 1.468135, "request_id": 100 }`.
- Async: top-level boolean `async` (default false). `{ "command": ["screenshot"], "request_id": 123, "async": true }` later returns `{"request_id":123,"error":"success","data":null}`. There is no start confirmation. Synchronous commands act like async ones that finished immediately. Cancelling async commands is not implemented for IPC (libmpv only). The field is `async`; the docs have no `async_command` name.

### Ordering
- The only stated guarantee: replies are sent in sequence.
- Events can arrive before the reply to your command. Read until your reply appears. Events carry an `event` key; replies carry `error`.
- mpv does not service the socket while a command runs and its reply is written, so events generated during that window are not written before the reply. Docs say this may change.
- Async completions can arrive in any order and do not block other traffic.
- Closing the connection destroys its IPC client and unregisters its observed properties. Keep the connection open. (Inference: each connection has an implicit handle, and its running async commands end with it.)

### IPC-only commands
- `client_name`: returns `ipc-N`.
- `get_time_us`: mpv internal time in microseconds (system time plus an arbitrary offset).
- `get_property <name>`: value in `data`. Example: `{ "data": 50.0, "error": "success" }`.
- `get_property_string <name>`: `data` is always a string.
- `set_property <name> <value>`, alias `set_property_string`; both accept native values and strings. Example: `["set_property", "pause", true]` returns `{ "error": "success" }`.
- `observe_property <id> <name>`; `observe_property_string` gives string data. Doc example: success reply, then `{ "event": "property-change", "id": 1, "data": 52.0, "name": "volume" }`.
- `unobserve_property <id>`: pass the same numeric id.
- `request_log_messages <level>`: enables `log-message` events. The level is the C API log level; its values are not in ipc.rst. Lua's msg.log levels are fatal, error, warn, info, v, debug, trace. Log text is for humans; don't parse it.
- `enable_event <name|all>`, `disable_event <name|all>`: most events are enabled by default.
- `get_version`: client API version of the remote mpv.

### Events (List of events; docs say these are the shapes JSON IPC sees)
- Events are asynchronous. Hooks are the only documented way to enforce synchronous handling.
- Common fields: `event`; `id` (reply_userdata, omitted when 0); `error` (only when an error applies).
- `start-file`: `playlist_entry_id`. Sent right before loading.
- `end-file`: `reason` is one of `eof`, `stop`, `quit`, `error`, `redirect`, `unknown`. Reason `error` adds an `error` field. Also `playlist_entry_id` (same as start-file), `file_error` (mpv error string, unset if unknown), and `playlist_insert_id` / `playlist_insert_num_entries` when a playlist entry was expanded (last inserted id = insert_id + num - 1). The Lua `error` form of file_error is deprecated since 0.33.0; docs say the error field will be unset for this event in future.
- `file-loaded`: sent after load, when playback begins.
- `seek`: any seek, including internal ones such as ordered-chapter segment changes.
- `playback-restart`: after a seek or file load.
- `shutdown`: player is quitting; clients should exit.
- `property-change`: `name`, `data` (new value). Requires observation.
- `log-message`: `prefix`, `level`, `text` (ends with a newline; may be multi-line).
- `command-reply`: `result` on success. IPC and Lua may not pass this event through.
- `client-message`: `args` (string array). Delivery to IPC is not documented.
- `video-reconfig`, `audio-reconfig`: VO/filter or AO reconfiguration.
- `hook` (`hook_id`), `get-property-reply`, `set-property-reply`: C API.
- Deprecated: `idle` and `tick`. Use property observation instead.
- New playlist entries can be visible (e.g. via the `playlist` property) before their end-file event.

### Hooks (C and Lua; ipc.rst does not mention them)
- Synchronous: the player waits for the hook to continue, and a protocol mistake can freeze it.
- `on_load` (after start-file, before playback-restart); `on_load_fail` (after on_load, before playback-restart and end-file); `on_preloaded` (after open, before track selection and decoder creation); `on_unload` (before end-file, also on error); `on_before_start_file` (before start-file); `on_after_end_file` (after end-file).

## Input commands (List of Input Commands, mpv.io)
Notation: `<x>` required, `[x]` optional.

Playback
- `seek <target> [<flags>]`: relative seconds by default. Flags: `relative` (default), `absolute`, `absolute-percent`, `relative-percent`, `keyframes`, `exact`; combine with `+`. Defaults: `keyframes` for relative, relative-percent and absolute-percent; `exact` for absolute. Scalable command.
- `revert-seek [mark|mark-permanent]`: undoes the last seek; a second call undoes the revert. Single file only.
- `sub-seek <skip> [primary|secondary]`: primary by default.
- `frame-step [<frames>] [play|seek|mute]`: 1 frame by default; `play` is the default flag (forward only). `frame-back-step` is `frame-step -1` with `seek`. Not for audio-only.
- `stop [keep-playlist]`: stops and clears the playlist unless `keep-playlist` is given. Otherwise essentially like quit.

Property manipulation
- `set <name> <value>`; `del <name>` (most properties cannot be deleted).
- `add <name> [<value>]`: default 1; on overflow or underflow the property is clamped to the maximum (doc wording).
- `multiply <name> <value>`.
- `cycle <name> [up|down]`: default up; overflow goes to the minimum, underflow to the maximum.
- `cycle-values [!reverse] <property> <v1> [v2 ...]`.
- `change-list <name> <operation> <value>`: operations that take no value still need `""`.

Playlist
- `playlist-next [weak|force]`, `playlist-prev [weak|force]`: default `weak` (do nothing at the end); `force` terminates playback instead.
- `playlist-next-playlist`, `playlist-prev-playlist`: jump by playlist-path.
- `playlist-play-index <integer|current|none>`: 0-based. `current` reloads the current entry; `none` stops (idle with `--idle`, otherwise exit).
- `loadfile <url> [<flags> [<index> [<options>]]]`:
  - flags, default `replace`: `replace`, `append`, `append-play`, `insert-next`, `insert-next-play`, `insert-at`, `insert-at-play`.
  - index: used only by `insert-at` and `insert-at-play`; below 0 or past the end appends. Added in mpv 0.38.0.
  - options: `opt=value,...`, set while the file plays and restored afterwards (per-file options). Since 0.38.0 options is the fourth argument, so pass `-1` as index when using it.
  - return value: none documented in this list. `playlist_entry_id` appears in start-file/end-file events and in `playlist/N/id`.
- `loadlist <url> [<flags> [<index>]]`: same flags, default `replace`.
- `playlist-clear`: removes all entries except the playing one.
- `playlist-remove <index>`: 0-based; `current` removes the playing entry, which stops playback and starts the next.
- `playlist-move <index1> <index2>`: entry index1 takes index2's place (indices shift).
- `playlist-shuffle`; `playlist-unshuffle` (works only once).

Scripting and execution
- `script-message [<arg1> ...]`: sent to every client; name clashes possible.
- `script-message-to <target> [<arg1> ...]`: sent to one client. Client names use only alphanumerics and `_`.
- `script-binding <name> [<arg>]`: `name` may be `script/binding`.
- `load-script <filename>`: returns `client_id` on success.
- `run <command> [<arg1> ...]`: no shell; detached; args undergo property expansion.
- `subprocess` (named args): `args`; `playback_only` (default true); `capture_stdout`, `capture_stderr` (default no); `capture_size` (default 64MB); `detach` (default no); `env`; `stdin_data` (probably does not work on win32); `passthrough_stdin` (default no). Result: `status`, `stdout`, `stderr`, `error_string`, `killed_by_us`. On Windows, `status` can be negative after a normal exit.
- `quit [<code>]`: exits with that process code. `quit-watch-later [<code>]`: exits and saves the position.

Filters
- `af <operation> <value>`, `vf <operation> <value>`: operations `set`, `add`, `toggle`, `remove`, `clr`. `clr` needs an argument (`""`). Labels `@name:` identify a filter; `add` with an existing label replaces it; a bare `@name` toggles its enabled state. Failed rebuilds are undone, but that check cannot run before video is configured.
- `af-command <label> <command> <argument> [<target>]`; `vf-command` has the same shape. Docs: vf-command works only with the lavfi filter. The rubberband audio filter documents its own af-command commands, `set-pitch` and `multiply-pitch <factor>`. Label `all` addresses all filters; target defaults to all.

Other
- `show-text <text> [<duration>|-1 [<level>]]`: default duration is `--osd-duration` (1000 ms by default).
- `screenshot [video|scaled|subtitles|osd|window]`, plus `each-frame`: returns `filename`. `screenshot-to-file <filename> [<flags>]`. `screenshot-raw` is client API and Lua only.
- Also documented: `dump-cache`, `ab-loop*`, `ignore`, `drop-buffers`, `context-menu`, `begin-vo-dragging`. Undocumented: `ao-reload` (experimental/internal).

Prefixes and sync
- Prefixes: `osd-auto` (input.conf default; some IPC/libmpv APIs use `no-osd`), `no-osd`, `osd-bar`, `osd-msg`, `osd-msg-bar`, `raw` (no property expansion; default for some APIs), `expand-properties` (input.conf default), `repeatable`, `nonrepeatable`, `nonscalable`, `async`, `sync`.
- input.conf commands run asynchronously. Lua and libmpv calls block unless `async` is used or the command is async by default. Commands whose waiting differs: sub-add, audio-add, sub-reload, audio-reload, rescan-external-files, screenshot, screenshot-to-file, dump-cache, ab-loop-dump-cache.
- Array and named-argument APIs (Lua `mp.commandv`, `mp.command_native`; libmpv): property expansion is off by default.

## Properties (mpv.io Properties section)
- RW means writable; everything else is read-only.
- Most options are also runtime properties with the same name minus `--`. Prefer the property; use `options/<name>` only when semantics differ.
- Many properties are unavailable at startup.

| Property | RW | Notes |
|---|---|---|
| time-pos | RW | Seconds; `time-pos/full` gives ms. `playback-time` is an RW alias (could differ before 0.39.0). Observation rate not documented. |
| time-remaining | RO | Estimate in seconds; `/full` for ms. |
| percent-pos | RW | 0-100; falls back to byte position when duration is unknown. |
| duration | RO | Seconds; unavailable if unknown; replaces the deprecated `length`. |
| pause | not listed | Not in the property list; it is the `--pause` option (entry not read). `core-idle` can differ from it. |
| core-idle | RO | Yes if the core is paused, restarting, or nothing is playing. |
| idle-active | RO | Yes when no file is loaded but `--idle` keeps mpv up. Renamed from `idle`. |
| eof-reached | RO | End of playback reached; mainly useful with `--keep-open`. |
| seeking | RO | Yes while seeking or restarting playback. |
| path | RO | Full absolute path of the current file. |
| filename | RO | Path stripped; percent-decoded for URLs. `filename/no-ext` also exists. |
| playlist | RO | Raw value is "useless". Sub-properties: `playlist/count`, `playlist/N/filename`, `/playing`, `/current`, `/title`, `/id`, `/playlist-path`. |
| playlist-pos | RW | 0-based; -1 if nothing is current; writing -1 idles or exits; out-of-range acts as -1. |
| playlist-count | RO | Total entries. |
| playlist-current-pos | RW | Sets the "current" entry without stopping playback; -1 clears it. |
| volume | not listed | `--volume` option: 0 is silence, 100 is no change, `--volume-max` defaults to 130. Runtime-settable per the intro. |
| mute | not listed | `--mute` option (default no). Runtime-settable per the intro. |
| audio-params | RO | `/format`, `/samplerate`, `/channels`, `/hr-channels`, `/channel-count`. |
| audio-out-params | RO | Same sub-fields, for the format sent to the audio API. |
| current-ao | RO | Active audio output name, as used by `--ao`. |
| audio-device | RW | Reads and writes `--audio-device`. A write schedules an AO reload. Does not report the device in use. Writing with no active AO does not enable audio. |
| audio-device-list | RO | Array of `{name, description}`. `name` is what `--audio-device` takes; `auto` is the default entry. Change notifications start on first read. |
| audio-exclusive | not listed | `--audio-exclusive` option. Works only on some AOs (wasapi, coreaudio, pipewire, audiounit); others ignore it silently. |
| af | RW | Like `--af` and the af command. Array of `{name, label, enabled, params}`. |
| metadata | RO | `metadata/by-key/<key>`, `metadata/list/count`, `metadata/list/N/key`, `metadata/list/N/value`. Reading it as a raw string does not work. |
| file-format | RO | Symbolic name; can be a list (mp4 reports `mov,mp4,m4a,3gp,3g2,mj2`). |
| audio-codec | not listed | Not in the docs read. Use `track-list/N/codec` (e.g. h264). `current-tracks/audio/codec` is an inference. |
| demuxer-cache-state | RO | `seekable-ranges` (list of {start,end}), `bof-cached`, `eof-cached`, `fw-bytes`, `file-cache-bytes`, `cache-end`, `reader-pts`, `cache-duration`, `raw-input-rate`, `ts-per-stream`. |

Other properties
- `ao-volume` (RW; only while an AO is active), `ao-mute` (RW), `hwdec` (RW).
- `user-data` (RW sub-paths): a shared tree for scripts and IPC clients. Sub-paths such as `user-data/<name>/...` can be read, written and observed. Not kept across restarts. `user-data/osc` and `user-data/mpv` are reserved.
- `options/<name>` (RW), `file-local-options/<name>` (RW, reset when the file stops), `option-info/<name>` (RO).
- `current-tracks/<video|audio|sub|sub2>/<field>` redirects to the selected `track-list` entry (example: `current-tracks/audio/lang`).
- `track-list/N/...`: `id`, `type` (audio, video, sub), `lang`, `title`, `codec`, `selected`, `external`, `decoder`, and others. `chapter-list` (RW) has `count`, `N/title`, `N/time`.
- `mpv-version`, `working-directory`, `pid`, `platform` (e.g. `windows`), `decoder-list`, `encoder-list`, `input-key-list`, `seekable`, `current-vo`, `current-gpu-context` (all RO).

## Lua scripting (DOCS/man/lua.rst)
- Loading: via `--script`, or auto-loaded from the `scripts` subdirectory of the config dir (`~/.config/mpv/scripts/` per the doc). The script name is the file name without `.lua`, with non-alphanumerics replaced by `_`; duplicates get a numeric suffix. `mp.get_script_name()` returns it. `.disable` files are ignored.
- Lifecycle: the script runs as-is, then the event loop starts. Each script runs in its own thread. The player waits until the script returns from its main chunk or enters the loop. Some properties are empty at startup, so observe them or read them inside handlers.
- Shutdown: a `shutdown` event makes the loop return. An endless loop stops mpv from exiting.
- Timers: `mp.add_timeout(seconds, fn [, disabled])` is one-shot. `mp.add_periodic_timer(seconds, fn [, disabled])` re-arms after each run. Both return a timer object whose methods are called with `:`: `stop()` (keeps elapsed time), `kill()` (resets), `resume()`, `is_enabled()`. Fields: `timeout` (RW), `oneshot` (RW). Timer resolution "may be as low as 50 ms".
- Script messages: `mp.register_script_message(name, fn)`. `fn` runs when `script-message`, or `script-message-to` addressed to this script, carries `name` as its first argument; the remaining arguments are passed to `fn`. Re-registering overwrites. `mp.unregister_script_message(name)` removes it.
- Commands: `mp.command(string)` (input.conf syntax; returns true, or nil and an error); `mp.commandv(arg1, ...)` (no quoting, no property expansion); `mp.command_native(table [,def])` (array, or named args keyed by `_name`); `mp.command_native_async(table [,fn])`, with `fn(success, result, error)`; `mp.abort_async_command(t)`.
- Properties: `mp.get_property`, `mp.get_property_native`, `mp.get_property_bool`, `mp.get_property_number`, `mp.set_property`, `mp.set_property_native`. `mp.observe_property(name, type, fn)` always delivers an initial callback; changes may be coalesced. `mp.unobserve_property(fn)` removes it.
- Time: `mp.get_time()` returns seconds (system time plus an arbitrary offset).
- Other: `mp.register_event(name, fn)`; `mp.enable_messages(level)` (for log-message); `mp.osd_message(text [,duration])`; `mp.get_script_directory()`.
- Global `exit()` (for mpv 0.40 and later) ends the script's loop, not mpv. The doc's polyfill for older versions sets `mp.keep_running = false`.

## Addressing a script from IPC
- Over IPC, send `["script-message-to", "<script name>", "<msg>", ...]`. `<script name>` is the sanitized file name from `mp.get_script_name()`. The handler is the function registered with `mp.register_script_message("<msg>", fn)`.
- Client names allow only alphanumerics and `_`. IPC client names look like `ipc-N` (contains a hyphen), so whether `script-message-to` can target an IPC client is not documented.
- The docs describe no way for a Lua script to reply to one IPC connection. The documented shared state is `user-data/...`, which IPC clients can observe. `client-message` exists, but IPC delivery is not documented.

## Windows builds (mpv.io installation page; repo README)
- The page recommends the latest git master build. It says the Windows binary packages are unofficial third-party builds, except the first-party GitHub CI build, which is mainly for testing and may lack features.
- Listed sources, in page order:
  1. Windows builds by shinchiro (git): https://github.com/shinchiro/mpv-winbuild-cmake/releases
  2. Windows builds by zhongfly (git): https://github.com/zhongfly/mpv-winbuild/releases
  3. First-party GitHub CI (latest commit): https://github.com/mpv-player/mpv/releases/tag/git-release
  4. Scoop: https://scoop.sh/#/apps?q=mpv&id=b05b47128464d8969416289383fbfc69a47353e3
  5. Scoop (git): https://scoop.sh/#/apps?q=mpv&id=72b493d66b164257cc87db56a4f581688afc13be
  6. Chocolatey: https://chocolatey.org/packages/mpvio
  7. MSYS2: https://packages.msys2.org/base/mingw-w64-mpv
  8. Compilation guide: https://github.com/mpv-player/mpv/blob/master/DOCS/compile-windows.md
- The page does not rank the builds, name files, give archive formats, list architecture variants (x86_64, i686, v3), publish checksums, or mention ARM64.
- Not fetched: the release pages above, and the latest stable release page (https://github.com/mpv-player/mpv/releases/latest, linked from the page).
- README: Windows 10 1607 or later is the minimum requirement.

## Measured on mpv 0.41 (Phase 3, through `--input-ipc-client=fd://3`)

Everything here was run, with `--ao=null` or `--ao=pcm`, rather than read.

Startup
- First reply after spawning: about 40 ms, or 1.6 s from a cold disk.
- A reply with no value has no `data` key at all, and neither does a `property-change` for an empty property. zod 4 needs `.optional()` on `z.unknown()` for that.

Order of events
- `loadfile` replies `{"playlist_entry_id":N}`, and its reply always comes before that entry's `start-file`. An entry that gets replaced before it starts has no events at all.
- Replacing: `end-file` (`stop`) for the old one, `start-file`, then `file-loaded`, `playback-restart`, `audio-params`. The per-file `start=` shows as a `seek` event after `file-loaded`.
- Moving on by itself: `end-file` (`eof`) then `start-file`, within a millisecond. It fires when the last audio has been written to the output, not when it's been heard: 0.4 s early with `ao=null`, and `time-pos` then sits at 0 until the old file's audio has drained.
- `playlist-next` replies first, then `end-file` (`stop`), then `start-file`. At the last entry it's refused with `error running command` (it's `weak` by default), and it does nothing.
- `append` at idle doesn't start anything, and an idle playlist keeps its finished entries, with `playlist-pos` at -1.
- `playlist-remove` of the playing entry: `end-file` (`stop`), and it goes on to the next or idles. Removing one before the playing entry changes nothing audible, and the indexes shift.
- The last file ending: `end-file` (`eof`) straight away, then about 0.4 s of draining before `idle-active` goes true. **The core is blocked while it drains, so commands wait for it**, including a `loadfile` (seen at 240 ms). A `stop` sent then can't cut off the end of the last track.
- `time-pos` is empty at `end-file`, is 0 or the `start=` at `file-loaded`, and with `start=`/`end=` stays in file time, so a range's position is `time-pos` minus its start.
- Seek: target is in `time-pos` as soon as the reply is written, so anything after the reply is about the new place. Seeking before `file-loaded` is refused with `error running command`.
- **Seeking while paused:** `time-pos` says the target, then 187 ms before the target, and stays there until it resumes (it was 6.813 after a seek to 7).
- After pausing there's usually no further `time-pos`.
- `audio-params` goes empty at every end of file and comes back at the next one. `audio-out-params` stays through a gapless change, and empties at idle.

`file_error`
- Missing file: `loading failed`.
- A path of 260 characters or more: mpv can't open it, with `Invalid argument`, though Node can, so a scan finds a file that then won't play. It comes back as `loading failed`, which the Player takes to mean the file is gone. The longest path in my library is about 150 characters, so nothing here handles it.
- Corrupt or empty file: `unrecognized file format`.
- A file with no audio in it, or a seek or `start=` past the end: `no audio or video data played`.
- `--ao=pcm` with a path it can't open is a way to get `audio output initialization failed` without touching a device. `file-loaded` and `playback-restart` come **before** that `end-file`, so a file having loaded doesn't mean it can play.
- After a failure mpv goes on to the next entry by itself, device failure included, so it fails again straight away for each entry it holds.

Runtime options
- `set_property replaygain` works at runtime, in the middle of a file. Measured through `--ao=pcm` on a tone tagged track -6 dB and album -12 dB: 0.00 at `no`, -6.00 at `track`, -12.00 at `album`, back to 0.00 at `no`, and -12.00 again. It lands at the next block written. The value is `no`, `track` or `album`, and anything else is refused with `unsupported format for accessing property`.
- `set_property end` works at runtime, **and stays set for every file after it**. `file-local-options/end` works the same and is gone when the file ends, and `none` clears an `end=` from `loadfile`. Values are strings.
- `set_property audio-exclusive` on an output that ignores it still reopens the output, which skips what was buffered: `time-pos` jumped 0.37 s ahead of real time on `ao=null`.
- A file loaded paused still opens the output: `current-ao` is empty at idle, and `null` (the driver's name) once the file is in, paused or not (`player.resume.test.ts`). On a real device with `audio-exclusive` that's the device taken.
- `current-tracks/audio` has `replaygain-track-gain`, `-track-peak`, `-album-gain`, `-album-peak`, with the album's filled in from the track's when the file only has those, and all absent when it has none.

Exiting
- `child.kill()` is gone in about 6 ms: the connection closes first, then `exit`, so a request can fail before anything says the process has gone.
- Spawning a path that doesn't exist: an `error` event (`ENOENT`) and no `exit`. `child.pid` is undefined and `stdio[3]` is still a socket, which closes.

Audio filters
- `af set` works at idle. `af-command` is refused there with `error running command`, because no filter exists until a file has started.
- **`af-command` values don't last.** A seek, a `loadfile`, a `playlist-next` and a gapless move to the next file all rebuild each lavfi graph from its `af set` text. Measured on a tone: commanded -12 dB was back to the set level after each of them. Pausing keeps it.
- So biquads restart at a gapless boundary: the output equals each file filtered alone, with no sample lost or added, and no step at the boundary bigger than a 1 kHz tone's own.
- `af set` during playback fires `audio-reconfig`, loses no frames and doesn't reopen the output.
- Commands by filter, all with `Parsed_<filter>_0`: `volume` takes `-6dB`; `equalizer`, `lowshelf` and `highshelf` take `gain`, `frequency`, `width`. A wrong target is refused. A change lands about 1.5 s of writer output later on `--ao=pcm`, so don't assume it's at the file's current size.
- With `t=q`, the `af` biquads match the RBJ curve within 0.05 dB (`player.eq.bytes.test.ts`).
- A band above a file's Nyquist doesn't fail: 20 kHz on a 32 kHz file played through whole.

Jumps
- `playback-restart` comes after the output has started again, for a load, a `playlist-next` and a seek (`handle_playback_restart`), so it's the first moment the new audio can be going out.
- `volume` and `mute` are applied as the output takes each block (`ao_post_process_data`), not when the audio is decoded. A file's start sees the value set during the gap, and at 100 the data isn't touched.

`--ao=pcm`
- It takes up to 65,536 frames at a time (`device_buffer`), so 1.5 s at 44.1 kHz, whatever `--audio-buffer` says, and each block has one gain. For finer, slow the source with `--af=lavfi=[asetnsamples=n=64,arealtime]` on a file with short frames, since mpv's core only hears commands between decoded frames. The first block still waits for a full buffer, and a chain from `af set` replaces that filter. A named pipe as `--ao-pcm-file`, read at the playback rate, paces it too, and each reopen shows as a new connection.
- It writes about 2,000 times faster than real time on a generated FLAC, so 30 seconds of audio takes 15 ms.
- It truncates its file every time the output opens, so a run that goes idle starts the file over.

## Recent changes and deprecations
- `loadfile` (0.38.0): the third argument became the insertion index. Code passing options as the third argument must add an index of `-1`.
- `playlist-pos` returns -1 when nothing is current (0.33.0 and later). Before that it was unavailable.
- End-file Lua `error` form of `file_error`: deprecated since 0.33.0. Event `idle` and `tick`: deprecated.
- Renamed: `idle` to `idle-active`; `demuxer` to `current-demuxer`; `fps` to `container-fps`; `length` to `duration`.
- Deprecated: `time-start` (always 0); `sub-text-ass` (use `sub-text/ass`); track `audio-channels` (alias); `enable-section`, `disable-section`, `define-section` (except for mpv internals); non-integer IPC `request_id`.
- `time-pos` and `playback-time` could disagree before 0.39.0.
- `--input-file` is removed; `--input-ipc-client` is FD-based and described as only somewhat similar.
- Global `exit()` is new in 0.40.

## Not settled by docs
- IPC failure reply strings: docs show only `success`. Measured: `property not found`, `invalid parameter`, `error running command`, `unsupported format for accessing property`.
- Whether replies to requests without an id carry `request_id` 0 (the doc says so; examples omit it).
- `loadfile` return value: none documented. Measured: IPC replies include `playlist_entry_id`.
- Whether `script-message-to` returns anything to the IPC caller.
- Whether IPC `observe_property` always emits an initial value. The example shows an event after the success reply, but the doc does not say it is an initial value. Measured: it does.
- Observation rate of `time-pos`. Measured: about 13 a second, unevenly.
- `audio-codec` as a property name, and whether `current-tracks/audio/codec` is documented.
- `pause`, `volume` and `mute` as properties: documented only as options; the `--pause` entry was not read.
- Whether IPC array commands expand `${...}` by default. Docs say `raw` is the default for some IPC APIs, and array APIs disable expansion by default in Lua and libmpv.
- Whether `client-message` events reach IPC clients, and whether `script-message-to` can address IPC clients.
- Hooks over IPC: ipc.rst does not mention them.
- Log levels accepted by `request_log_messages`: the C API values were not read.
- Whether async IPC commands are cancelled when a connection closes (inferred from the libmpv rules).
- Windows: release asset names, archive format, checksums, architecture variants, and which build is preferred.
- Not reached: Property Expansion, the `--pause` option entry, and the FILES section (Windows config and scripts paths).
