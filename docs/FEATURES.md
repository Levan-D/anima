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
- [x] Resume where I left off: the queue, the track and the position come back paused, and only play makes a sound
- [ ] Stay awake while music plays: Off, Keep running or Screen on, set separately for plugged in and on battery

**Library**
- [ ] Point at my library folder (a setting), Rescan button
- [ ] Library scan + album art (embedded and folder images, cached thumbnails)
- [ ] CUE reading (one big FLAC shown as separate tracks; in the data model from day one)
- [ ] Browse by artist / album / genre + search
- [ ] Albums sorted by disc + track number
- [ ] Reveal in File Explorer (the only file operation)
- [x] Library report: a Settings tab listing what's worth fixing by hand in foobar2000, such as MP3s, low-res or missing covers, bad tags and duplicates, each with its tracks, playable and revealable. It never changes a file, and its counts catch up after a Rescan

**Queue + playlists**
- [ ] Queue: one-off and unsaved, with "play next" and "add to queue", which goes after the current song and anything added before it, not at the end of the album
- [ ] Named playlists that survive restarts: create, rename, delete, reorder, add and remove tracks
- [ ] Playlists store file references. A missing file stays in the list greyed out, never silently deleted

**Screens + input**
- [ ] Now-playing view with album art
- [ ] Context menu (right-click, long-press on touch), multi-select
- [ ] Windows media keys / overlay + in-app hotkeys
- [ ] Responsive 10" (touch) → 24", then scales up to 65"; visible keyboard focus for the TV
- [ ] Mini player: an ordinary window other apps can cover, with no queue
- [ ] Dark mode, a few purposeful animations

**Extras**
- [x] Waveform seekbar
- [x] Parametric EQ
- [x] Headphone measurements on the EQ, behind one small control: import a file or fetch from AutoEq on request, a line predicted from measured plus the real curve, targets shown only by rig, a bass slider on the target, and hearing the EQ off at a level matched by curve. Prediction, never a statement about your pair. No score, no match percent, and nothing third-party in the repo but one credited derived band, the Preference range, for over-ears measured on a 5128
- [x] AutoEq's target curves are fetched once and kept: the Headphones section gets them the first time it opens, Refetch curves picks up what's new or changed, and the list marks which ones share a rig with the headphone
- [x] Match to target beside Use AutoEq's correction: fits an EQ to the chosen target and Bass, unsaved, and only when pressed. Per headphone, Match settings hold what a measurement can't say: Bass handling, Fit or seal, and Correct up to
- [ ] Lyrics: read embedded + `.lrc` sidecars, synced highlighting
- [ ] Lyrics: fetch missing ones from LRCLIB
- [ ] Lyrics: per-track timing nudge, plus or minus in seconds, saved in SQLite so the song stays in time
- [ ] Stats, for fun

**Recommendations** (2026-10-31)
- [ ] Radio: a way to listen, not a mode. A page, and R to open it, with what's playing in the middle and what radio would play next on a barrel. Pressing one, Play from here, or Start radio from this song, which keeps the song playing, makes radio what plays next. Playing a list makes that list the source again. The queue I had comes back with Back to your queue
- [ ] Endless: a switch in the Queue's header, off by default and remembered. Just before the queue runs out, a few owned tracks that suit it go on the end, visibly. Off, the queue just ends
- [ ] More like this, on a track or a playlist: a list like any other
- [ ] Discover: music I don't own that listeners of my artists also play, and who points at it. Names only, no play button
- [ ] Settings → Data: counts, last run, Update and Cancel for the library, lyrics, fingerprints and listener data. **Only ever manual:** nothing fetches or analyzes at startup
- Only artist and track names leave this machine, and the ids those names turn out to have
- Look up lyrics only stops automatic lookups. Searching, choosing and Update always work

### Settings v2 (to design)
- [ ] Outside services are visible and editable. The app, library and saved data are permanent, but APIs can shut down, so anyone using the app has to be able to fix it. Per service, starting with lyrics (LRCLIB), then MusicBrainz and ListenBrainz: see what it uses, change the base URL (a mirror or self-hosted copy), add a key if one is needed, test it, reset to default, turn it off.
- [ ] A different kind of API has a different response shape, so a URL field only helps one with the same format. Say that in the UI. To cover: each service has a typed response contract, validated at the edge, and an adapter maps a new API's response onto it, maybe as a user-editable field mapping.

### Later / maybe
- [ ] Output device picker (Windows default is fine for now)
- [ ] Shuffle / repeat
- [ ] Seasonal themes: Christmas and Halloween songs stay out of radio, Endless and More like this out of season, and come up more often in season, unless what you started from is one. Found by strong words in titles and album titles or a genre tag, and a person's mark on a song, album or artist always wins. Dates, boost and what's in each are in Settings, Seasons. Files are never touched, and playing by hand never changes
- [ ] Radio's energy wave: stays near the energy you're listening to, and about every few songs plays a close match that's noticeably calmer, then climbs back. In Radio settings, from the cog in Tune it, you set how close songs stay, how often and how big a breather is, how long the climb takes and an overall lean. Off, radio plays exactly as it did before any of this. Goes by how soft or heavy a song is, not its tempo
- [ ] A fake FM dial on Radio: stations from the library, always on air, static between stations. On hold as a gimmick until it's practical on touch
- [ ] Internet radio stations through a public directory. Planned after the November 6 usage refresh
- [ ] The big test sweep, on max effort. Planned after the November 6 usage refresh

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
- [x] **EQ / ReplayGain vs bit-perfect** (2026-10-31): exclusive turns nothing off. They stay independent, and the signal line says what is altering the sound.
- [ ] Volume in exclusive mode: DAC knob only, or digital volume in the app?
- [ ] What "scales after ~24 inches" means concretely (breakpoints vs fluid scaling, touch target sizes)
- [ ] Layout details: where search, filters, playlists and settings go with no top nav; what happens on portrait or narrow windows
