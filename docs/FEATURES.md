# Music player (foobar-style)

A personal player for my own local library. A side project: semi-educational, not part of the main curriculum, built to keep using.

**Started:** 2026-10-19 · **Horizon:** ~3 months · **Status:** building

## Decisions so far

- **Local files only**: FLAC + MP3. No streaming.
- **Read-only on my files.** foobar handles tagging, lyrics embedding, conversion and CUE splitting. This app is for listening. The one file action is Reveal in File Explorer.
- **No v1/v2 split** (2026-10-30): one list, built in dependency order.
- **Now playing is the cornerstone:** a very visual app. Album art as big as the screen allows (it's square), the rest of the screen is the giant media list. Minimal chrome, maybe no top navigation.
- **Claude builds it, I criticize** (2026-10-30). Repo, schema and build order: [PLAN.md](PLAN.md).
- **Library location:** I copy the same music folder to each machine, so the app points at a folder (a setting). Everything inside is stored relative to that folder. I always copy from one main machine, so the database lives in the music folder and travels with it. No cloud sync. Settings shows where everything is.
- **Missing files never crash anything:** tracks no longer on the device get separated out in the playlist and flagged for me to look into.
- **Fetched lyrics live in SQLite, linked to the track.** Music files are never altered. PC only for now; phones come later.
- **Output:** Windows shared mode by default, **WASAPI exclusive behind a toggle** (I know exclusive mutes every other app; that's why it's a toggle). No ASIO.
- **Artists:** trust my tags. Group by album artist, fall back to artist. No smart splitting of "feat." etc.
- **Library:** manual "Rescan" button, no folder watcher.
- **ReplayGain:** read the tags foobar already wrote. Never compute loudness.
- **TV (65"):** laptop over HDMI + wireless keyboard, so it's the same app scaled up and driven by keyboard. No remote or 10-foot-specific mode.

## Features

### v1: everything I want (build order, top first)
**Engine + playback**
- [ ] Play / pause / seek, volume, gapless playback
- [ ] ReplayGain (from tags)
- [ ] WASAPI exclusive toggle

**Library**
- [ ] Point at my library folder (a setting), Rescan button
- [ ] Library scan + album art (embedded and folder images, cached thumbnails)
- [ ] CUE reading (one big FLAC shown as separate tracks; in the data model from day one)
- [ ] Browse by artist / album / genre + search
- [ ] Albums sorted by disc + track number
- [ ] Reveal in File Explorer (the only file operation)

**Queue + playlists**
- [ ] Queue: one-off and unsaved, with "play next" and "add to queue"
- [ ] Named playlists that survive restarts: create, rename, delete, reorder, add and remove tracks
- [ ] Playlists store file references. A missing file stays in the list greyed out, never silently deleted

**Screens + input**
- [ ] Now-playing view with album art
- [ ] Context menu (right-click, long-press on touch), multi-select
- [ ] Windows media keys / overlay + in-app hotkeys
- [ ] Responsive 10" (touch) → 24", then scales up to 65"; visible keyboard focus for the TV
- [ ] Mini player (always on top)
- [ ] Dark mode, a few purposeful animations

**Extras**
- [ ] Waveform seekbar
- [x] Parametric EQ
- [ ] Lyrics: read embedded + `.lrc` sidecars, synced highlighting
- [ ] Lyrics: fetch missing ones from LRCLIB
- [ ] Lyrics: per-track timing nudge, plus or minus in seconds, saved in SQLite so the song stays in time
- [ ] Stats, for fun

### Later / maybe
- [ ] Output device picker (Windows default is fine for now)
- [ ] Shuffle / repeat / resume where I left off

### Out (on purpose)
- Tag editing, file conversion, CUE splitting: foobar does those
- Streaming services
- ASIO

## Audio engine

Every player runs the same pipeline:

```
file ──► decode ──► DSP ──► output ──► DAC
(FLAC)   (to raw     (ReplayGain,  (Windows mixer
          samples)    EQ)           OR exclusive)
```

| Option | Who does the work | Exclusive mode? | Verdict |
| --- | --- | --- | --- |
| A. Web Audio (Chromium) | Chromium decodes, I build the DSP | **Never**: always the shared mixer, resampled | Kills the main wish |
| B. mpv as a headless engine | mpv does decode, DSP and output; my app sends JSON commands over an inherited stdio handle | Yes (`--audio-exclusive=yes`) | **Chosen (2026-10-19)** |
| C. Native library via FFI (BASS, miniaudio) | C code called from TS | Yes | Too much non-TS pain |

**The rule:** my app is the source of truth, mpv is a dumb executor. mpv never decides what plays next, what the queue is, or what the EQ is. It does what it's told and reports back.

Known fixes for B's weak spots:
- **State over IPC:** main process owns the mpv connection, observes properties, forwards to React via preload. Match replies with `request_id`.
- **Seekbar:** ~5 position updates/sec, interpolate in the renderer with `requestAnimationFrame`. Seek optimistically, reconcile on confirm.
- **Stale events:** give every load an id, drop events from old loads.
- **Gapless:** the app holds the queue. mpv only holds current + next (`loadfile … append`).
- **CUE:** parse it myself. Tracks are time ranges inside one playing file, never separate loads.
- **Live EQ:** fixed chain of labeled ffmpeg `equalizer` filters, change gains with `af-command`.
- **Media keys and overlay:** silent `<audio>` + Media Session. Don't register media keys with `globalShortcut`: it kills the overlay session.
- **Waveform:** stream a downsampled ffmpeg decode, ~2,000 peaks, cache as a BLOB in SQLite.
- **Crashes:** on mpv `exit`, restart, reload the file, seek to the last position.
- **Orphans:** solved by design. mpv talks over an inherited stdio handle and quits when the app dies.
- **Live spectrum:** dropped (the audio isn't in Chromium).

## Open questions

- [x] **Engine spike:** done, see [spike-results.md](spike-results.md). Three checks need me at my DAC, listed there.
- [ ] 📌 **EQ / ReplayGain vs bit-perfect** (pinned): what does the exclusive toggle do to the EQ, ReplayGain and volume?
- [ ] Volume in exclusive mode: DAC knob only, or digital volume in the app?
- [ ] What "scales after ~24 inches" means concretely (breakpoints vs fluid scaling, touch target sizes)
- [ ] Layout details: where search, filters, playlists and settings go with no top nav; what happens on portrait or narrow windows
