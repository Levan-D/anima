# Build plan

Claude builds, I criticize. This is the spec for the repo, the architecture, the schema and the build order. Features are in [FEATURES.md](FEATURES.md). Engine facts proven by testing are in [spike-results.md](spike-results.md). Library docs digests are in [research/](research/README.md).

## The four rules that prevent spaghetti

1. **Only `main/playback/` knows mpv exists.** No mpv property name or command appears anywhere else. Swapping the engine would touch one folder.
2. **The main process owns all state.** Queue, playback, playlists and settings live there. Every window (main, mini player) is just a view: it sends commands and renders events. React never decides what plays next.
3. **One typed contract between main and renderer.** `shared/ipc/contract.ts` lists every command and event. Each one is defined once, inputs are validated in main, and both sides get their types from it.
4. **Dependencies point one way, and lint enforces it.** Renderer: `app → features → components → lib`. Features don't import other features. Renderer and main can only share `shared/`. A violation fails lint, so the structure can't rot quietly.

From my Philosophy of Software Design notes:
- **Deep modules:** `Player`, `Library` and `Database` have small interfaces hiding a lot of work.
- **Information hiding:** rule 1.
- **No pass-through layers:** no `service → repository → dao` chains that only forward calls. A module talks to SQLite directly.
- **Split by knowledge, not by time:** the scanner is one module, not `readStep` / `parseStep` / `saveStep`.

## Stack

| Piece | Choice | Why |
| --- | --- | --- |
| Shell | Electron 45 + electron-vite 6 | Decided. Spawns mpv, real filesystem access |
| UI | React 19, Vite 8, Tailwind 4, `motion`, `lucide-react`, Radix primitives (`radix-ui`) | Same base as Smash Patty. Radix for accessible menus, dialogs and sliders, including long-press on touch |
| Playback state | Zustand 5 | Small, selector-based, so position ticks only re-render what reads them |
| Database reads | TanStack Query 5, `networkMode: 'always'`, `retry: false`, long `staleTime` | Local data: invalidated by "library changed" events, never paused for being offline |
| Long lists | `@tanstack/react-virtual` | The media list has about 5,700 rows |
| Database | `better-sqlite3` 13 + plain SQL, **no ORM** | The schema is the design. Prebuilt N-API binary, verified in Electron 45 with FTS5 and worker threads, so no compiler and no rebuild (electron-builder needs `npmRebuild: false` for that) |
| Tags | `music-metadata` 12 | Reads tags, embedded art. ESM. Parse one file at a time |
| Audio | bundled mpv 0.41 over inherited stdio | See spike results |
| Waveforms, thumbnails | `ffmpeg-static` | Already a dependency of the plan, so no second native image library |
| Validation | `zod` 4 | Outside data and IPC inputs, once, at the edge |
| Logging | `electron-log` 5 (main only) | Renderer errors are forwarded over IPC. Preload stays minimal |
| Tests | Vitest 5, Playwright for Electron smoke tests | Plain Node, because the SQLite binary is N-API |
| TypeScript | `~6.0` | `typescript-eslint` caps at `<6.1`, same reason Smash Patty pins it. Recheck when it moves |

## Repo layout

```
src/
  shared/                  imported by both sides, no Node, Electron or React
    ipc/contract.ts        every command and event, zod input schemas, types
    ipc/channels.ts        names only, safe to bundle into the preload
    domain.ts              Track, Album, Playlist, PlayerState…
    result.ts              Ok | Err, AppError and error codes
  main/
    index.ts               app lifecycle and wiring, nothing else
    ipc.ts                 binds the contract to the modules below, validates input and sender
    playback/              Player: mpv process, IPC client, queue, gapless window, EQ
    library/               scanner (worker thread), reconcile, CUE parser, art
    db/                    connection, migrations/*.sql, queries grouped by table
    lyrics/                sidecar + embedded + LRCLIB
    waveform/              ffmpeg decode to peaks (worker)
    stats/                 listening log and rollups
    datasets/              what Settings' Data tab drives: run, cancel, last run
    fingerprints/          what tracks sound like, from a model (worker)
    listeners/             what listeners hear together, from outside services, by name
    recommend/             the engine, pure, and the worker it runs in
    settings/              per-machine settings file
    system/                windows, protocols, security, crash recovery, thumbar, reveal, binaries, logging
  preload/
    index.ts               a single sandboxed CJS file, exposes the typed api
  renderer/
    index.html, main.tsx
    app/                   root, providers, window routing (main vs mini), error boundaries
    features/              one folder per capability
      LibraryGate/  Library/  Search/  ScanProgress/  Settings/ (with Stats as a tab)
      NowPlaying/  Transport/  Queue/  Playlists/  Lyrics/
      Equalizer/  Stats/  MiniPlayer/
      MediaSession/  Hotkeys/
    components/
      ui/                  Button, Text, Slider, ContextMenu, Toast… (knows nothing about music)
      music/               TrackList, AlbumArt, AlbumCard… (domain parts used by several features)
    hooks/                 generic hooks only
    lib/                   cn, typed api client, player store, query keys, formatters
    styles/                globals.css, typography.css
resources/
  mpv/                     from scripts/fetch-binaries.mjs, not in git
  models/                  the same, and non-commercial, so it never goes in git
  icons/                   thumbar icons
build/                     app icon
tests/
  e2e/                     Playwright Electron smoke tests
  fixtures/                generated at test time with ffmpeg, never committed audio
.claude/skills/            conventions, adapted for this repo
```

## Conventions

The full rules live in `CLAUDE.md` and `.claude/skills/`, adapted from Smash Patty and Redflag. The ones that shape everything:

- **Three-layer tokens** (primitives → semantic → utilities). Components never use a primitive.
- **One fluid unit with a floor and no ceiling, following the shorter screen axis.** This is the 10" → 65" answer: everything scales from `--spacing-cell`, with a 44px floor on tap targets. CSS only sees pixels, not inches.
- Screen-size differences are CSS, never JS. Flex only, no grid.
- `<Text>` owns typography, `<Button>` owns button styling.
- Named exports. `type`, not `interface`. No `Type` suffix. No `enum`. No `any`.
- `useEffect` only inside named hooks in `.ts` files. No nested ternaries. Motion durations are tokens.
- Loading and error are early returns before the main JSX. Skeletons for async sections.
- Default to no comment.

**Library docs come first:**
- Before writing against a library, read its docs for the installed version, not memory. Start from `docs/research/`.
- mpv options and IPC commands get checked against the manual for the bundled build, and against the spike results.
- Follow each library's recommended patterns, including Electron's security checklist. Any deliberate deviation gets a short comment saying why, and a mention at the phase review.
- If the docs don't settle how something behaves, a test or the spike does. Guesses don't ship.

**Process rules:**
- `contextIsolation` on, `sandbox` on, `nodeIntegration` off. No `file://` in production: the renderer is served from an `app://` scheme.
- Slow work never runs on the main thread. The scanner, art and waveforms use workers, because `better-sqlite3` is synchronous and a long query would stall mpv control.
- Art reaches the UI through an `art://` protocol, never base64 over IPC. Hash-keyed, so there are no paths from the renderer.
- The renderer never sends a file path. Commands take ids, and main resolves them.

## The Player

The boundary everything else depends on. Commands return promises, state arrives as events, and nothing exposes mpv.

**mpv process:** spawned with `--input-ipc-client=fd://3` over `overlapped` stdio, `--no-config`, `--idle=yes`, `--vid=no`, `--audio-display=no`, `--cover-art-auto=no`, `--terminal=no`, `--load-scripts=no`, `--osc=no`, `--ytdl=no`, `--input-default-bindings=no`, `--input-vo-keyboard=no`, `--input-media-keys=no`, `--media-controls=no`, `--gapless-audio=weak`, `--prefetch-playlist=yes`, `--replaygain=album`.

`gapless-audio=weak` is deliberate: `yes` would resample later files to the first file's rate, which breaks exclusive mode's real-rate output.

**The modules,** all in `main/playback/`: `mpvProcess` starts and supervises the process, `mpvClient` is JSON lines and request ids, `queue`, `gaplessWindow`, `cueBoundaries` and `signalPath` are pure, and `player` does the I/O around them. `createPlayer` is the only thing `index.ts` and `handlers.ts` see.

**When it starts:** after the main window's first load, not before. `child_process.spawn` on Windows hands the child every inheritable handle in the process, with no way to give it a list, and Chromium's channel to a renderer it's launching is inheritable for as long as that takes. mpv spawned during that keeps a copy of the channel, so main never hears when that renderer dies, and a crashed window never comes back. `smoke.spec.ts` catches it, because it did: starting mpv alongside the window stopped `render-process-gone` firing at all. A restart after a crash could still land on a window being opened, but that takes two rare things in the same 50 ms, and only costs noticing a later renderer crash, so nothing guards against it.

**The window:** my app holds the real queue. mpv only ever holds current + next, kept in sync by `gaplessWindow`, a pure function from queue state to the entries mpv should have and the steps to get there. `playlist_entry_id` from `loadfile` replies maps mpv entries back to queue items, so a transition can't be misread.

**Commands don't wait for mpv.** A command changes the state on the spot and returns, and `player` then brings mpv into line one step at a time, working out each step afresh. So five presses of Next only load where they ended up. What mpv holds is recorded as commands are sent, not as they're answered, which is what makes a race come out right: an entry being removed is already not ours when its `start-file` shows up, so it's dropped, and whatever the queue wants next gets loaded. Only one seek is ever out, and a newer one waits its turn, so dragging only costs where it ended up.

**Stale events:** every load bumps `loadId`. Position events are ignored between a load and its `file-loaded`, and events about an entry that isn't held any more are dropped. `file-loaded` has no id, so it counts only if the last `start-file` was for the entry that should be playing.

**A jump chosen by hand** (Next, Previous, a pick, playing a list, a seek while playing) goes quiet first, in `jumpFade`. Leaving a file early makes mpv stop and reset the output, which a track running into the next never does, and that reset is where static on a device is suspected, unproven: see research/audio-verification.md. So `volume` falls to 0 over 40 ms, 20 ms of silence goes through the device's buffers (120 ms in exclusive, where a fresh client was measured 110 to 116 ms deep), and `drain` only then lets the jump's step out, so presses during that only cost where they end up. After `playback-restart` it holds silent for 20 ms and rises over 20 ms. From a pause it goes straight to 0 ahead of the unpause. Only commands start it, so natural transitions stay byte-identical. It gives up after 3 s, since being stuck silent is worse. Pause, Stop and back-to-queue are left as they were: they stop dead. It adds about 116 ms, or about 209 ms in exclusive.

**Position** goes out about 5 times a second, and once on pause and seek. While paused, mpv's ticks are ignored: the position only moves by seeking then, and after a seek mpv reports about 190 ms short of it until it resumes.

**CUE tracks** are time ranges inside one playing file. Contiguous ranges are one mpv entry, and `Player` watches position and moves the queue index when it crosses a boundary. A range whose next item isn't contiguous is loaded with `end=` set, and `file-local-options/end` moves it when the queue around it changes, because plain `end` would carry over to later files. Going to another range of the file that's playing is a seek.

**Resuming:** `resumeStore` keeps two `library_meta` rows, because track ids only mean something in their own database, so another folder has its own or none. The ids are written when `queueVersion` moves. The place (index, added-section end, position) is a small row of its own, written every 5 s while playing and on pause, seek, a change of track or queue, and quit, so a crash costs seconds and a 5,700-id queue isn't rewritten on a tick. When the library is ready and mpv is up it restores once per library, unless something has already been chosen by then, and until then nothing is saved, or the empty queue would replace what's there. It shows as paused with nothing opened, and the load waits for Play, with the position as `start`, so the next entry goes in as usual and play continues gaplessly. Seek, Stop, Next and Previous before that only move where it will open. `restoreQueue` is pure: tracks gone from the library or marked missing drop out, the next that's left takes over from a current one that's gone, at its start, and with none after it nothing is current. A queue that ended comes back at the start of its last track, since at the end it would just finish again. A file that's gone without being marked yet fails its load like any other and is skipped with the usual toast. Stats count nothing, because a paused player reports no position and Next on a restored track that hasn't sounded isn't a skip. The load waits because mpv opens its output for a paused file too, and in exclusive mode that would take the device from every other app at startup. The signal has nothing to say until Play.

**Failures**, told apart by `file_error`:
- `loading failed`: the file is gone. Mark it missing, toast with Reveal, skip. Stops after trying the whole queue, with an error.
- Anything else that isn't the device, such as `unrecognized file format` for a corrupt file: the same, except it's not marked missing, because the file is there.
- `audio output initialization failed`: the device is the problem, not the track. Don't skip. If exclusive, fall back to shared and resume, with a toast. If shared also fails, show the error with Retry.
- mpv process exits unexpectedly: restart, restore volume, mute, ReplayGain, output mode and EQ, reload, seek back. Automatic restarts stop after 3 quick failures (under 10 s each), and `player.retry` starts over.

**The EQ** is one filter per label, in `eqChain`, with the preamp from `shared/eqCurve`: the automatic headroom, which is the curve's top across rates plus 1 dB and at least 2 dB down, sized on 420 tracks in research/headphone-eq.md and not a guarantee, or a value from -24 to +6 dB set by hand, saved per preset. Gain stops at ±12 dB, and settings saved over that are clamped on load. A hand-set preamp over flat bands still counts as audible, and when it leaves less room than Auto would `signalPath` says by how much. `volume` stays first in the chain even at 0 dB, because it's what keeps the chain in float, and `player.eq.bytes.test.ts` guards that. mpv rebuilds every filter from its `af set` text at each seek and each new file, gapless ones included, which undoes anything `af-command` did. So a value that's moving is commanded, and 300 ms after the last change it's also set. Neither reopens the output. On but flat means no chain at all, since that's what keeps it bit-perfect, and the same 300 ms stops a drag through 0 dB from taking the chain out and back. Each step comes out of `drain` ahead of any load, so a new mpv has its chain before it opens a file.

**Added tracks:** `queue` keeps `addedEnd`, where what was added by hand ends. Add to queue inserts there and Play next right after the current item, ahead of it, and both move it along, so A playing with B and C next, adding X then Y, gives A, X, Y, B, C. It shrinks as those play, and stays put going back while some are left. Going past it, or back with none left, starts it again right after wherever that lands. A remove takes out what left it. A move into it joins it, and a move out of it leaves. Replacing the queue starts over.

**EQ presets** are per machine, in the settings beside the current EQ, and `main/eq/presets` handles them: names unique whatever their case, and applying goes through `player.setEq`. A preset shows as changed when the bands or the preamp no longer match it. A file is one preset in Equalizer APO's text format (`main/eq/apoFile`, pure): import takes PK, PEQ, LS, LSC, HS and HSC. A Preamp line turns Auto off at its value, and without one Auto stays on. Gain over 12 dB is clamped and the toast says on how many bands. Anything it can't read refuses the whole file with the line number. Export writes the effective preamp, so a preset on Auto comes back from its own file set by hand. The dialogs open in main.

**Headphone measurements** live in `main/headphones`, with their data per machine under `<userData>/headphones/`, and nothing third-party in the repo. A measurement or target comes from a file, as `frequency,raw` CSV or REW text (`responseFile`, pure, refusing the whole file with a line number and capped at 8 MB), or from AutoEq on a click: `autoeqIndex` reads its `results/INDEX.md` at one pinned commit, and names each rig from AutoEq's own `dbtools`, or Unknown when they don't say. Crinacle's measurements aren't public, so those are presets with no line. A fetched preset goes through the same `importEqPreset` as a file, keeping its preamp, and no response is ever read from a preset. The sums are `shared/headphoneCurve`: 1/12 octave smoothing, alignment over 300 Hz to 3 kHz, predicted as measured plus `curveDb` at the track's rate and nothing else, and `rigMatch`'s states: defined on this rig, same family and so approximate, and different or unknown, which stay hidden with why. Only equal exact rigs count as the same rig, and a translated target is approximate whatever it says. While a measurement shows, the plot's one scale widens in steps from ±18 to ±36 dB to fit it, and nodes work the same on it. Lines fade from 6 to 10 kHz and everything's greyed above that, except the EQ's own curve, which is exact. The tools stay behind one small control, and their curves aren't read until it's used. "Hold to hear EQ off" keeps the chain and sets every band to 0 dB, with a preamp at the EQ's power mean over 100 Hz to 10 kHz, so it only moves values. Main keeps what it took over from in its own file, so a crash mid-hold can't leave the off side as the saved EQ, and it only ever comes down: with a preamp set so high the EQ is above the file, the screen says how far short it is. The one exception to nothing third-party is `shared/preferenceRange`, a band derived once from CC BY data and credited in `THIRD_PARTY_NOTICES.md`: a toggle shades it for an over-ear on a 5128, and it feeds nothing else. Wording and what's refused: research/headphone-eq.md.

**Match to target** is `shared/headphoneCorrection` (AutoEq's equalization curve, ported) and `shared/headphoneMatch` (the fit, scored through `curveDb`), both pure, run in `match.worker` since it takes hundreds of milliseconds. `headphones.match` takes ids, refuses a rig the target can't be shown on, and applies the result unsaved with Auto preamp, as the preset's button does. Bass, and each measurement's `match` settings, go into the fit, and nothing refits by itself. Settings that only touch the low end start from the fit without them and move only the bands at 500 Hz and under, so the treble can't jump when the bass changes. AutoEq's method is MIT: `THIRD_PARTY_NOTICES.md`.

**Small calls made while building it:** Next and Previous keep a paused player paused, while picking a track or a queue row starts it. Skipping past a failed last track wraps to the top only when nothing has played yet, so a queue that does play can't go round forever. A seek after the queue ended reopens the last track from there. Removing the current item moves on to the next one, or stops if there's none.

## The Library

The other boundary. `createLibrary` (`main/library/library.ts`) is made once in `index.ts`. It owns the status state machine and the open connection, and it's the only way anything reaches the database.

**What later phases use:** `library.status()`, `library.onStatus(listener)` (returns how to stop listening: a status that isn't `ready`, or `ready` for another folder, means ids no longer mean what they did, which is when the Player drops its queue), `library.read((queries) => …)`, `library.perConnection(create)` (below), `tracksByIds(ids)` (in the given order, repeats kept, missing tracks included), `playableTracks(ids)` (the same, with where each track is in its file), `absolutePath(trackId)` (null if unknown, and the file may still not be there), `markMissing(trackId)` (a scan clears it when the file is back), `markChanged()` (call it after any write that should count as "the library changed on this machine").

**Everything goes through the guard,** the one place that turns `SQLITE_CORRUPT` or `SQLITE_NOTADB` into the `db-corrupt` status plus `err('db_corrupt')`, and a vanished disk into a re-evaluation. `library.read` hands out `queries.ts`, which only reads: the writes in there stay inside Library, so nothing can change the database without Library saying so. A later module keeps its own statements in a query module and takes `const playlists = library.perConnection(createPlaylistQueries)`. `create` runs once per connection, which changes when the folder does, and `playlists((queries) => …)` is guarded the same way. It calls `markChanged()` after writing.

**Status:** `no-folder` → `folder-missing` → `not-writable` → `db-too-new` or `db-corrupt` → `ready`. `db-corrupt` carries a `cause`: `damaged`, `not-ours`, `migration-failed` (the file is unchanged), or `lost`, for a `library.db` that's empty or gone with backups beside it, as an interrupted copy can leave. Starting empty there would lose the playlists, and the rotation would soon take the backups too, so only a rebuild does that. It also carries `backupAt`, the date of the newest backup that passes a check. A file that opens but can't be written is `not-writable`, and a locked one becomes that at once, because the first open only waits 250 ms: it's on main. Restore and rebuild set the old file aside as `library.bad-<time>.db` and never delete it. `changedElsewhere` is in the `ready` status, so the "last changed on another machine" notice is the UI's to show. The words on these screens are main's, one sentence per cause, and the system's own go to the log.

**Files:** `library.db` and `backups/` (last 3, at most one a day, one before any migration) in the data dir. That's `<music folder>/.player`, or `MUSIC_PLAYER_DATA_DIR/<first 8 hex of sha1 of the folder>`. An unpackaged build falls back to `.dev/data` if that variable isn't set, so `npm run dev` can never write to a music folder. The art cache is `<userData>/art-cache`.

**A scan, in order:** `walking`, `reading` (tags, committed every 100 files, so the list fills in live), `hashing`, `writing` (marks files missing, prunes, replaces `scan_issues`), `art`. Everything before `writing` is safe to lose: cancel or kill it at any point and nothing has been marked missing, and the next scan carries on because finished files match on size and mtime and unhashed ones have `audio_hash` NULL. A first scan that never finished (`last_scan_at` is NULL) starts again whenever the library opens, because a library that's half there looks finished. It starts before the `ready` status goes out, so a folder about to be scanned never shows as having no music in it. Hashing comes after reading because it's most of the time: 770 of my FLACs have no MD5 in their header, and every MP3 has to be read whole. In `hashing` and `art`, `filesFound` and `filesDone` count that phase's own items. A row the database refuses is one issue, not a dead scan: its batch goes in again a file at a time.

**What the walk skips:** `.player`, `$RECYCLE.BIN` and `System Volume Information`, whatever their case. Nothing else with a leading dot: `...And Justice For All` and `.38 Special` are music. Links aren't followed, and each one is listed in the scan report, with nothing behind it marked missing.

**The last scan's report** is saved in `library_meta` as soon as the scan ends, cancelled or not, and read back when a library opens. It's about that database, so it travels with it: a restored backup shows what it had, and each folder shows its own.

**Tags:** `common` is a mix per field, so the edge reads what it can't trust from the block itself. A file with Vorbis comments takes track, disc, date, album artist and genre from them alone: anything else in a FLAC is a leftover. The parser's `common.genre` also takes the Vorbis `STYLE` tag, which Discogs taggers fill in, so genre reads `GENRE` itself and foobar2000 agrees with it. Otherwise track and disc come from APEv2, then ID3v2, then whatever's left. An MP3 takes its genre from ID3v2 first, as foobar2000 shows it, read from the raw frame because the parser eats `Pop (indie)`. Numbers and durations that make no sense stop at this edge.

**Identity:** `tracks.id` survives retags, moves and case-only renames. A new file is a move only if its audio hash matches exactly one row that lost its audio. That's a gone row, or a row whose path now holds different audio, so a swap keeps each id with its recording, and a file moved onto a path that had gone keeps its own id. The row it took the path from goes missing, parked at `.player/displaced/<id>/…`, where the walk can never find a file for it. New audio at a path that matches nothing just updates that row. Rows are never deleted by a scan, except artists, albums, genres and art with no tracks left. A file that won't parse keeps its old row, with its old size and mtime, so it's tried again next scan. `bad_tags` issues carry over between scans for files that weren't re-read.

**CUE sheets:** one sheet cutting one file gives tracks `cue_index` 1..n. The first of them and the whole file are the same row, so a sheet coming or going keeps that id live, and the row's lyrics go, since they were timed to other audio. Other tracks a sheet no longer has aren't deleted: they move to a missing file row at `.player/displaced/cue-<file id>`, keep their playlists and stats, and the same number takes them back. A sheet of several files, one track each at 0, says the files are the tracks already, so it's ignored, whatever it names: my two real sheets are that kind, and name files that aren't there. `cue_sheets` keeps each sheet's size, mtime, file and issue. A sheet is read again only if those changed or audio beside it did, and its file is read again only if that could change its tracks. Rows are saved after the reading, so a cancelled scan redoes them. A file changing re-reads its tags, which the tracks start from, so it goes through the sheet again every time.

**Lists leave out missing tracks** everywhere except the `missing` filter and `tracksByIds`. An artist's lists include what they're the album artist of, as well as what they play on.

**Art:** the scanner only records `art` rows (`hash`, where it came from, `mime`). `artCache` on main answers `art://` and decides what to do, and its worker writes `<hash>.<ext>` and `<hash>.thumb.jpg`, and works out `art.color`, which main saves. Nothing is started for a hash the database doesn't know. A color can arrive after a list was read: `library.changed` says so. Hashes are sha1 of the image bytes, so a URL can never change meaning. One image can be embedded in one file and sit in another's folder, so where a file got its art is on the file (`files.art_source`), and that's what says a scan should recheck its folder. A scan also keeps the row's own source current for folder images, and rebuilding tries every file using the image, so a copy with an empty cache doesn't lose art because a folder was renamed. A folder image that can't be read isn't the same as one that's gone: the art stays, with an issue. Pruning the cache keeps everything when the open library has no art at all, since that's more likely the wrong folder than a reason to throw away minutes of work.

**Workers can't see Electron.** `?modulePath` only works in the app, so `index.ts` passes the paths in, and the tests use the in-process runners in `library/testFixtures.ts`. The real worker gets one test of its own, bundled with Vite in `scan.worker.test.ts`.

## The list column

Everything to the right of the art and above the transport, composed in `app/ListColumn.tsx` because it's made of several features.

**What decides what fills the window:** `features/LibraryGate` reads the status. Anything but `ready` gets a screen of its own, with the actions that fix it.

**The cache only hears from main:** `lib/useLibrarySync` is the one subscriber. `library.changed` invalidates by scope, `library.status`, `scan.state` and `settings.changed` go straight into the query cache. Keys are in `lib/queryKeys`, and each starts with its `ChangeScope`, so invalidating the scope reaches them. Nothing refetches otherwise: `staleTime` is `Infinity`. A status that means a different database drops everything under `library`.

**Navigation:** the tabs are Genres, Artists, Albums, Tracks and Playlists, opening on Albums. The Queue isn't a tab: a transport button and Q show it as a place in the history, in the Library page's list column, coming from another page if need be. Pressing again returns to where the list was, no tab is lit while it shows, and it keeps its scroll like a tab does. Above all of this, `lib/pages` holds which page is showing: Library, Radio or Discover, one component each in `app/pages` composing features into a layout (`AppLayout`, or `WideLayout` with the flat transport), under one `app/PageBar`. A page that's away unmounts, and its state stays in these stores. Anything that navigates brings Library forward, and Back from another page goes to Library. A genre lists its artists, an artist has their albums first and then their tracks, and an album its tracks. An artist reached through a genre shows everything of theirs, with no filtering by that genre, and the counts on the genre's artist rows are their whole too. `lib/navigation` holds the tab, a history of what's been drilled into, and the search text. Actions are plain functions, so a row can navigate without subscribing to anything. Search sits over the history rather than in it, until a result is opened: then it goes in, so Back returns to the results. Scroll positions are in `lib/listMemory`, written as a list scrolls and read as it mounts, along with the sizes they were right for, so a size that changes while a list isn't showing still lands on the same rows. A place left by going back or through a tab starts from the top next time. A rebuild or restore starts the navigation over, since the ids in it are from another database.

**Every list is one component:** `components/music/MusicList` takes sections (a grid of albums, rows of tracks, headings) and works out the lanes and the sizes. `components/ui/VirtualList` does the virtualizing, the scroll memory and the keyboard, and knows nothing about music. Row sizes are numbers measured from the fluid tokens by `ListMetricsProbe`, because a `calc()` custom property can't be read as one. Tabular columns are CSS only, through a container query in `em`, which follows the fluid type.

**The keyboard crosses regions:** Arrow Down or Enter in the search field, or Arrow Down on a tab, goes to the list, and Arrow Up on its first row comes back. `lib/listDom` does this, because those parts can't import each other. Escape, Alt+Left and Backspace (outside a field) go back. A refresh that remounts what has focus, as a new album pushing a card into the next lane does, puts focus back on the same album by its id.

**Selection** is `lib/selection`: a set of row keys for the list on screen, no DOM, with a selector per row. A click selects that row alone, on the same surface as a press, and Ctrl and Shift add to it and extend it. The selection bar is for two or more, or a finger's selection mode, so a click doesn't pop anything up. Going back clears a selection with a bar before going anywhere, and one row's clears on the way through. A menu opened on a row in a selection of two or more acts on all of it, through `selectionMenuFor`; the queue has its own, because Play there can't replace the queue. The list ends with padding so nothing focused sits under the transport's fade, and the selection bar floats rather than taking a row.

**The EQ modal's draft** (`useEqDraft`) stays until a state from main matches it, not until the command's reply: the state event can come after the reply, and a drag that fell back to it jumped to an older value every few frames while playing.

**Toasts** sit bottom left over the art, never over the list. The viewport lets the pointer through, and with something to operate under them (the lyrics, the equalizer, marked `data-under-toasts`) a toast keeps only its own buttons. Errors, warnings and info differ by icon and edge color, through tokens. `showToast` returns an id: passing it back updates that toast, and one with `progress` shows a bar and stays until it's updated without any. Dismissed while running, it only comes back with an outcome. The lyrics import doesn't use it, because one command covers both the file picker and the import, and a bar would show during the picker.

**Esc and toasts:** a Radix toast is a dismissable layer that re-registers as the top one when it re-renders, so with a toast up Esc can close the toast instead of the menu on top, without marking the key as used. So `useBackKeys` looks for an open menu or dialog in the DOM rather than trusting `defaultPrevented`.

**Scan progress** is the only thing that re-renders on `scan.state`. The list hears about new music through invalidation, at most every 1.5 s, and structural sharing keeps the rows that didn't change.

## The now-playing view

Three features around one store: `features/NowPlaying` is the art pane, `features/Transport` the bottom of the list column, and `features/Queue` a sheet, on `components/ui/BottomSheet`, that `app/TransportDock` puts beside the transport so it rises from there and is as wide. It covers the title and seekbar and stops above the two rows of buttons, so the Queue button still closes it. The card's rise is a whole `transform` so it stays on the compositor, and the list mounts when it's up: nothing under it moves, and mounting the rows can't hitch it. Whether it's up is `lib/queueSheet`, not navigation, so the list under it keeps its state; `lib/selection` holds the covered list's selection until the sheet's list is released. The sheet is a modal Radix dialog with no portal and no overlay. What's beside it stays pressable, and the music's hotkeys and Ctrl+A skip `data-bottom-sheet` where they'd otherwise give way to a dialog.

**State:** `lib/playerStore` holds what main last said, fed by one subscription that starts in `main.tsx` before the first render, so a window opening mid-song doesn't paint idle first. Everything reads it through narrow selectors, because a state from main is a new object every time. Commands go through `lib/playerActions` and come back as a new state. The queue is fetched by `queueVersion` with `gcTime: 0`: each version is its own entry, and an old one is megabytes nobody can use.

**Position never goes through React.** `lib/playerPosition` takes `player.position`, and `lib/positionClock`, which is pure, works out where it is between reports. One animation-frame loop runs, only while something is playing, something is listening and the window can be seen, and it calls whoever registered with `usePlayerPosition`, who write to the DOM and say how long until they'd have anything new to show. It sleeps until then, because a frame nobody needs still wakes the GPU. Nobody asks for more than four a second, and whoever's registered paints in the same frame, so with no playing bars on screen the window presents four frames a second while the music plays: this laptop stalled at 5 to 20 a second ([research/ui-stack.md](research/ui-stack.md)). The bars aren't in this loop: they run on the compositor, in steps of their own. While it runs the clock only goes forward: a report a little behind is jitter and is ignored, a little ahead is caught up with gently, and far away means something really happened. A seek moves the clock at once, and for half a second after it, a report far from there is one that left main before the seek did. A new `loadId` means zero for a different track and holding still for the same one, and either way it asks main.

**The seekbar** is Radix's slider with the value taken away. `components/ui/LiveSlider` hands it a value no pointer can land on, so it reports every move, even back to where a drag began, and draws the line and the dot itself with transforms. Radix's arrow keys step from the value it holds, so the keys are `Seekbar`'s own: 5 s, and 30 s with Shift or the Page keys. A drag stops listening to the position until it lets go, then seeks once.

**The waveform** is drawn by `Seekbar` behind that same slider, which still does all the input. It's a continuous shape mirrored around the center, one column per device pixel with no gaps: lighter peaks outside, a darker RMS body inside, and a thin line for silence. The two are painted on canvases once per data and size, then used as CSS masks on two pairs of colored layers, so they follow the accent's fade with no redraw, and only the played pair's clip moves with the position. The worker decodes at 44.1 kHz, since most files are at that rate and it was no slower than resampling to 8 kHz, which read 3 to 7% of full scale short on real tracks. Main decodes one file at a time: a get for another file kills the running ffmpeg, and that get resolves to null, which is why the query keeps nothing (`gcTime: 0`). The scan never touches `waveforms`, so a row older than its file's `mtime_ms` counts as no levels.

**The art** waits to be decoded in an `Image` of its own, then goes in with `decoding="sync"`, fading in over the old one, which stays whole underneath, so the pane never dips towards the background. Under reduced motion there's nothing to fade and no layers either, since an animation of no length still leaves one frame at its start.

**The accent:** `lib/albumAccent` is a pure function in OKLCH. It keeps the hue, gives a washed-out average some chroma back, and lifts the lightness until it reads at 4.5:1 on the lightest surface it can sit on, `--surface-active`. A gray stays gray. No color means the neutral tokens. Both variables are registered with `@property`, so `:root` eases them.

**Playing from a list:** a mouse selects with one click and also plays with two, a finger or a pen plays with one tap and selects through the long-press menu, and Enter plays. It's one click handler going by `pointerType` and `detail`. The queue becomes that list, from that row. Each row has its own selector for whether it's current, by id, or by place in the queue, where the same track can be twice. A new track re-renders the two rows it concerns, pausing only the bars, and anything else none. The bars are CSS keyframes on `transform: scaleY`, in `steps(5)`, with their own keyframes, length and offset each, so they run on the compositor and only the row that's current has them. They pause with the player and in a hidden window, and under reduced motion they aren't animated. That has the compositor presenting about 26 frames a second while they're on screen: Levan chose moving bars over the old 4 frames a second, which looked like a slideshow. The cost is in [research/ui-stack.md](research/ui-stack.md). One context menu covers a whole list: `components/music/TrackMenu` hangs on a `display: contents` element around it, and the row comes from where the press landed.

**The transport has the same rows at every width:** title, artist and album, seekbar and time, controls, then the signal with the icon toggles. It goes by its own width, in `em`, only for the volume: below 28em the controls would leave too little of a slider, so it gives way to `SoundButton`, on the bottom row since the controls row has no room for a seventh: a press mutes, and hovering, keyboard focus or a tap shows the bar, on `components/ui/HoverSlider`. That's the only part in the tree twice, and the mini window has only the button, opening its bar to the left. Down to 320 wide nothing else goes, and every button stays `size-tap`. `--spacing-transport` measures these rows, and the art's stacked height is worked out from it. The bitrate is the file's size over its length, worked out in the query, so it needs no column, stays the same all the way through, and counts the tags and art in the file. `signalPath` says which `SignalKind` the signal is, so the renderer never reads meaning out of the alterations' words: `system` when Windows is mixing or the output differs from the file, even with an EQ on as well, because turning mine off wouldn't make it bit-perfect then. `--signal-*` are the dot's colors. **Stop** is `player.stop` in main, also S and the media session's stop: paused at 0 of the current track with the queue kept, and there's no stopped status. In `error` it only moves the position, so Retry still plays.

## Playlists

`main/playlists/` has its own statements through `library.perConnection`, and reads tracks through `library.read`. Every write ends in `markChanged()` and `library.changed` with `playlists`. A `library` change invalidates the playlists too, since a scan can mark what they show as missing.

**Two orders:** what's stored has missing items where they always were, so they come back in the same place. What's on screen is the playable ones, then "Not on this device". A move from the screen counts among the playable rows, and `placeInPlaylist` turns that into the stored place, so a drag never lands relative to something that isn't showing.

**Each item gets its own `Track` object** in `playlist.get`. A playlist from before tracks went in once can still hold one twice. IPC keeps a shared object shared, and `playTracks` finds the row by identity, so it would otherwise always play from the first one. A track that's in twice lights both rows while it plays: main knows the queue's place, not which item it came from.

**The drag** is `components/ui/DragReorder` and `hooks/useDragReorder`, and knows nothing about music: rows carry `data-drag-id`, and it hands back `(ids, toIndex)`, with `toIndex` counted in the list without them. That's what `playlist.moveItems` and `player.moveInQueue` take. A mouse drags from anywhere on a row. A finger only drags from `data-drag-handle`, because on the row it scrolls or long-presses. It captures the pointer on the container, since the row under a finger can be virtualized away. Rows are one height, so a place is arithmetic: a frame costs only the rows mounted, whatever the list's length, and each gets its shift as a direct transform, without a render. What follows the pointer is a copy of the pressed row, so it survives being virtualized away. It's hand-written rather than @dnd-kit, whose sortable re-renders rows as the pointer crosses them. After a drop the rows hold their shifts until `ids` shows the new order, and drop them in that same commit, so nothing flashes back. Move up and Move down glide the two rows, from the same change of `ids`.

**"New playlist…"** is one dialog, in `ListColumn`, opened with `askForNewPlaylist`, because a menu item can't hold a dialog that outlives it. `TrackMenu` only asks for the playlists while a menu is open.

## The Library report

A Settings tab, `features/Settings/components/ReportTab`, that's a to-do for fixing things by hand in foobar2000: it only reports, and says so. `main/report/checks.ts` is a list of groups, most worth hand-fixing first (Files, Tags, Art, Audio quality, Lyrics, Recommendation data), and a check is one entry: a name, a line of plain words and one SQL query that selects ids in the order to list them. Adding one needs nothing else, because the words and the groups cross IPC with the counts. The sizes are named constants at the top.

Every read is its own short worker (`report.worker`, `jobs.ts`), since all the counts together take about 1.6 s on 5,719 tracks. `listener_lookups` holds keys worked out in JavaScript, so the worker's connection registers `artist_key` and `title_key` as SQL functions. The answer is cached under the `report` scope, and every `library.changed` makes it stale, whatever its scope, since the checks read all kinds of data. So a retag shows up after a Rescan.

**What it needed that wasn't kept:** whether a file has a ReplayGain track gain, an album artist tag and, for an MP3, a Xing or Info header, in `library/fileFacts`. A scan writes them from now on. Nothing clears an mtime for the files already there: the report's first read starts a worker that reads each header once, about 2 minutes on `D:\Music` against a whole rescan, and those checks say "Checking" rather than "All good" until it's done. It got 198 MP3s with no header, what [research/audio-verification.md](research/audio-verification.md) measured. A FLAC's unset MD5 needed nothing new: its `audio_hash` starts with `frames:`. Cover sizes come from the head of each cached full image (`library/imageSize`, about 2 s for 685), at the end of the art pass and on the report's read. Whichever couldn't be read isn't tried again until the number of them changes.

**What it can't see:** lyrics inside a file or in an `.lrc` aren't stored, so "No lyrics" means none stored, and the row says so. Bitrate is size over length as everywhere else, so an MP3 with big embedded art reads higher than its audio. "Title is the file name" is the `bad_tags` scan issue, since that's all that kind ever says. Scan issues have no track, so that check lists paths and reasons instead.

## Recommendations

**Nothing happens by itself.** `main/datasets` runs what Settings' Data tab asks for, one job per dataset, and "Update everything" takes them in `DATASET_IDS` order, waiting for each. Each module brings a `Dataset`: counts, why it can't run if it can't, and start. Last runs are in `library_meta`. `data.state` goes out at most four times a second, and only its progress is new each time: counting is a few milliseconds on main, so it's done when asked and when a job starts or ends.

**Fingerprints** run in a worker with its own connection. The preprocessing in `melSpectrogram` is ported from the spike, and gave a cosine of 1.0000 with its vector for the same file. Any change to it changes what every stored vector means, so it would need a new model id. Work is whatever has no row, so cancelling and resuming need nothing else, and a bad file is counted and tried again next run. Two inference threads, with ffmpeg at below-normal priority.

**Listener data** goes through MusicBrainz for ids and ListenBrainz for neighbours: [research/recommendations.md](research/recommendations.md) has what each will do without an account, and it's less than the docs suggest. A row in `listener_lookups` means it's been asked, and a failed lookup leaves none, so it comes up again next update. Six failures in a row stops the run with a quiet note. Artists go first because they're minutes and most of the value, and tracks take hours. Owned is never stored: `recommend/snapshot` works it out on every read, so adding a Van Halen album makes what's already stored about Van Halen count, and drops them from Discover, with no fetching. Keys come from `library/names`: "The Beatles", "Beatles" and "Beatles feat. Billy Preston" are one artist, and a title is compared without what versions add to it.

**The engine** is `recommend/engine`, pure, with its numbers in `TUNING`. A strong signal (sound, artist links, track links) counts only if it has something to say about the seeds, and the weights rescale to what's left, so it works on either alone. With none there's no answer, even with genres in common, since those are only a bonus. So are plays. Skips and being a hub take away. Hubs are vectors near everything, which over-matched in the spike: 400 sampled tracks' ten nearest neighbours vote, and three times a fair share starts a penalty.

**It all runs in `recommend.worker`,** started the first time it's wanted, which holds the library in memory. `lastChanged` is its generation, so anything that goes through `markChanged` makes it read again, except hubs, which wait for the count of vectors to change. Play counts don't go through it, so they can be a little behind. On all 5,719 tracks with 1,280 numbers each: 410 ms to read, 3.2 s for hubs the first time, 10 ms to answer however many seeds, because they're averaged first.

**Radio** is a source, not a mode: there's no on or off. The page's barrel is `components/ui/Barrel` with `hooks/useBarrelBrowse`: what's been spun to is held by key, so a track change moves nothing until it glides back. It browses radio's own queue for the past, since main doesn't take more picks on request: they arrive as it plays. `radio.preview` says what it would play from what's playing, or a recent play or owned pick with nothing playing, and changes nothing. `radio.play` makes it the source: `Player` replaces the queue, as playing a list does, and `queue` becomes radio's own, so mpv's window, gapless and everything else keep working on it with nothing special. A current track that's carrying on keeps its queue id and isn't touched, and only the entry mpv held next is swapped. Pressing a pick drops what it went over, since those were never heard. `queueTopUp.ts` holds what can be added and when: radio asks with four or fewer left and fills to eight, seeded from the last five played, leaving out skips, which also count against their artist. Picks go on through `appendToEnd`, not `enqueue`, because what I add by hand goes ahead of them. Resume saves radio's queue as the queue, and that it's radio's in `resume_radio`, in one transaction. The Radio page's `radio.preview` answer is kept in `Player`, so pressing a pick carries on with what the barrel showed.

**Seasonal themes** live in `shared/themes.ts`: one entry per theme, with its words, genre words and default dates. Detection is worked out from the data at each snapshot (`recommend/themes.ts`), so new files need no step of their own and only marks are stored, in `theme_marks`, by name keys so rescans can't undo them. A track's mark beats its album's, which beats its artist's, which beats detection. Main puts today's verdict in the ask (`recommend/seasons.ts`) at every ask, so a running station picks up the season at its next top-up. The engine hides a theme out of season unless a fifth of the seeds or what the run was asked about has it. The in-season boost comes after the score floor, and only a theme the run was asked about gets past the floor or the energy slots. Switched off, the ask carries no season and the engine takes the same path as before themes.

**Radio's energy** is one number per track: `recommend/energyHeads.ts` runs three published heads over the stored vectors in the recommendation worker, and `energy.ts` takes each one's percentile and averages them. It's worked out per snapshot and never stored, because percentiles shift as the library does. Without the models it's null, the engine goes by similarity alone, and `radio.startOptions` says why, for the slider. The engine fills radio's picks slot by slot: most are ordinary, and every few it looks among the 60 closest for a calmer one, then for two that climb back. Nothing fills a slot means the ordinary pick. Nothing is held between asks except which picks were calm, in `Player`, and the rest comes from the queue, so picks can be made again when a slider moves. The rules and what they rest on are in [research/energy.md](research/energy.md). `RadioEnergy` in settings holds all of its numbers, and switched off, the ask carries no energy at all, so the engine takes the same path it did before energy.

**Endless** is a setting, off by default, and the only other thing that adds to a queue by itself. With at most one left it asks for a few, seeded the same way, and they go on the end of the person's own queue. A failed ask isn't repeated until the queue changes, and says so once. Replacing the queue drops an answer that's on its way, and one that arrives after the queue has ended starts it. The switch is in the Queue's header.

**Discover isn't a list of tracks.** It's `VirtualList` directly, since `MusicList` is for what can be played. Its rows are buttons that do nothing, because that's what the list's keyboard lands on, and the TV has only a keyboard. `recommend/discover` works it out in the worker and keeps the answer with the snapshot, so it's computed once per `lastChanged`: the top 2,000 by how many owned artists point at each, with the closest six of those, one sleeve each. Genres are inferred there too: each recommender's genres as shares of its tracks, times how strongly it recommends, the top two if the second is at least 40% of the first. Filtering is in the renderer, over what's already there, and the chosen genres outlive the page in `discoverFilter`.

## Where data lives

| Data | Location | Why |
| --- | --- | --- |
| Library index, playlists, fetched lyrics, stats, waveforms, fingerprints, listener data, where playback left off | `<music folder>/.player/library.db` | Travels with the copy |
| Library path, volume, output mode, window position, EQ, stay awake | `%AppData%` settings file | Per machine |
| Album art cache | `%AppData%` cache | Rebuildable, no reason to copy |
| Logs | `%AppData%` | Per machine |

**Stay awake:** `main/system/powerKeeper` holds at most one `powerSaveBlocker`, only while playing or loading, from the Plugged in or On battery setting. Electron 45's types list `on-battery` for macOS only, so besides the events it rereads `isOnBatteryPower` once a minute while playing. Both rows always show, since Electron has no reliable way to tell there's no battery.

For development and tests only, `MUSIC_PLAYER_DATA_DIR` overrides the `.player` location, and `MUSIC_PLAYER_MPV_ARGS` appends mpv arguments (`--ao=null`), so nothing writes to the music folder or makes a sound. `scripts/dev-env.sh` sets both, and points tool caches and temp files inside `.dev/` as well. `npm run dev` passes its own `--user-data-dir`.

**Settings is a page,** `app/pages/SettingsPage`, from the gear in `app/PageBar` and Ctrl+, with `components/ui/VerticalTabs`: a column of tabs, along the top below `--container-side-tabs`. Its panes are made of `components/ui/ModalSection` and `components/ui/Field`, and its buttons are the `outline` variant, because nothing on the page is music, so what can be clicked has to look it. `lib/pages` holds the tab and the page it came from, so Esc and the back arrow return there and focus goes back with them. Showing the missing tracks leaves it on the way to the list. The tabs are Playback, Interface, Library, Library report, Lyrics, Data, Storage and Stats, and each pane scrolls by itself. It shows: the interface size · the library folder with a Reveal button, the last scan and its report, and what it couldn't read, as one line per reason until the files are asked for · db path with a Reveal button · db and cache sizes · track, album and missing counts · which machine last changed the library, and when · mpv and ffmpeg versions and paths · Reveal log.

On startup, if the db was last changed on another machine, a one-line notice says so. It doesn't try to merge: copying from the main machine is the whole sync model.

**`lyrics-library/lyrics.db`**, in this repo and out of git because lyrics are copyrighted, holds lyrics for my tracks. They come from LRCLIB's database dump in two steps: `scripts/lyrics-dump/extract.mjs` reads the rows that could match out of the gzipped dump into a small file of its own, which takes at most three passes of about eight to fifteen minutes, and `scripts/lyrics-dump/match.mjs` picks each track's lyrics from that file in a few minutes. Tightening a matching rule only needs `match.mjs`, while accepting more artists, albums or titles needs `extract.mjs` again. Rows carry `audio_hash`, so Phase 6 can import them into the `lyrics` table of any copy of the library. It imports `found` and `instrumental` rows and leaves `not_found` behind, so the app still asks LRCLIB once when I play one of those.

## Database schema

The source of truth is `src/main/db/migrations/`. Conventions: all paths are relative to the music folder. Migrations are numbered SQL files tracked with `PRAGMA user_version`, and a run is backed up first. `foreign_keys = ON`, `journal_mode = WAL`, and a checkpoint on clean exit so the `.db` is complete before a copy.

- `files`: one row per audio file. `rel_path`, `size_bytes`, `mtime_ms`, `audio_hash`, format fields, `art_hash`, `missing_since`.
- `tracks`: what I browse and play. A normal file is one track (`cue_index` 0). A CUE album is one file with many tracks, each a time range.
- `artists`, `albums`: grouped by album artist, falling back to artist. Album is unique per artist and title.
- `genres`, `track_genres`: a track can have several.
- `art`: hash-keyed, remembers where each image came from so the cache can rebuild on any machine.
- `playlists`, `playlist_items`: items have their own id, but a track goes in once: adding one that is already there is left out and the toast says so. `position` is rewritten in one transaction on reorder.
- `lyrics`: one-to-one with tracks, so no join table. `not_found` stops re-asking LRCLIB every play. `origin` says who put the row there: `lookup` for the app, `search` or `file` for my own pick from the lyrics panel. A pick is never `not_found`, so the dump import already skips it, and a lookup that finishes afterwards leaves it alone. Only `lyrics.refresh`, which I have to ask for, or clearing it from the panel, replaces it.
- `lyrics_offsets` (added in Phase 6): `track_id` primary key with `ON DELETE CASCADE`, and `offset_ms`. It's separate from `lyrics` because the timing nudge applies to every source, and `.lrc` and embedded lyrics have no row there. Replacing a track's fetched lyrics clears it, since the nudge was for the old timing.
- `waveforms`: per file, peaks and RMS. They scale with duration so a CUE track still gets a detailed slice. Migration 7 dropped the old peaks-only rows, which get worked out again on play.
- `play_events`: the listening log behind stats. A row is a play, written at 30 s or half the track, so time on a track skipped before that isn't counted anywhere. Its `listened_ms` grows in batches after that, with no `library.changed`.
- `cue_sheets` (added in Phase 6): what each sheet came to last time. See "CUE sheets" above.
- `scan_issues`: what the last scan couldn't read, and why.
- `fingerprints`: by `audio_hash`, `start_ms` and `end_ms` (-1 for the end of the file), so a retag, a move or a rescan leaves them alone and a CUE range has its own. `model` says what made it: another model reads as missing. Nothing removes a row when its file goes. About 29 MB, which every backup carries too.
- `art.width`, `art.height`, `files.has_replaygain`, `has_album_artist`, `has_gapless_header`: only the Library report reads them. NULL is not read yet, and a width of 0 is an image that couldn't be measured.
- `listener_lookups`, `similar_artists`, `similar_tracks`: by normalized name, never by track id, and everything an answer holds is kept. See "Recommendations".
- `track_skips`: Next pressed in a track's first 30 s. Only the engine reads it, and it says nothing to `library.changed`.
- `tracks_fts`: FTS5 search with diacritics removed and prefix indexes.

**How the schema handles what could go wrong:**
- **File disappears:** a rescan sets `missing_since` and deletes nothing. Playlists keep the row, shown in a separate "not on this device" section. It comes back by itself when the file returns. Deleting is only ever a deliberate "Remove missing" action, with a warning.
- **Track identity:** `id` is a plain integer that never changes and means nothing. Artist + album + title is not the identity: retagging would change it, and it isn't guaranteed unique.
- **File moves or gets renamed:** the rescan matches new files against missing ones by `audio_hash`, and updates the path instead of creating a new track. Playlists, lyrics and stats survive. FLAC uses the audio MD5 stored in its header (instant), falling back to hashing frames if it's unset. MP3 hashes the audio frames with tags skipped. If two files share a hash (duplicates), nothing is matched automatically.
- **Retagged in foobar:** path and `audio_hash` stay the same, so `id` stays and only the tags get re-read.
- **ReplayGain isn't stored:** mpv reads it from the file's tags.
- **What I picked for a track wins over everything:** a record chosen from a search or a `.lrc`/`.txt` loaded by hand beats even a timed `.lrc` beside the file, because I picked it after seeing what was showing. The panel says quietly which source is showing, so clearing a pick and landing on a sidecar or tag isn't a mystery. Searching is free text (`/api/search?q=`), choosing fetches that record (`/api/get/{id}`), and both work whatever the Look up lyrics setting says, because that only stops what the app does by itself. The words never go to the renderer until they're chosen.
- **Embedded and `.lrc` lyrics aren't stored:** read when playing. Without a pick, timed lyrics come first wherever they're from: `.lrc`, then timed from the `lyrics` table or LRCLIB, then embedded plain, then plain from the table. Embedded lyrics in my library are never timed, so embedded-first would lose sync on most of the files that have them. Embedded text under 15 words isn't lyrics. A positive `[offset:]` shows lines sooner, one over 5 s either way is ignored because rival uploads go as far as -47 s, and the hand nudge goes on top.

## Error handling and states

**The goal: one bad file, request or process never takes the app down.** Every failure gets exactly one of these responses, picked by who can fix it:

| Response | When | Example |
| --- | --- | --- |
| **Handle silently** | The app can fix it and I don't need to know | mpv crashes: restart, reload, seek back |
| **Retry, then tell me** | Probably temporary | LRCLIB timeout: retry with backoff, then "no lyrics right now" |
| **Toast + fallback** | It didn't work, but there's a sensible alternative | Exclusive device busy: fall back to shared, with a toast |
| **Skip and report** | One item failed out of many | Corrupt file in a scan: skip it, list it in the scan report |
| **Ask me to fix it** | Only I can solve it | Library folder gone: screen with "Pick folder" and "Retry" |

| Failure | What happens |
| --- | --- |
| Library folder missing (drive unplugged, moved) | Full-screen prompt: pick a new folder or retry. The database comes with the folder, so it reconnects by itself |
| Track missing when played | Skip to the next one, toast with Reveal folder. Marked missing in the list |
| Unreadable or corrupt file | Listed in the scan report with its reason. The scan carries on |
| Malformed CUE or tags | Fall back to the whole file, or to the filename as title. Noted in the scan report |
| Database corrupt or newer than the app | Don't touch it. Screen offering to restore the automatic backup or rebuild. Playlists are only lost if I choose rebuild |
| Migration fails | Runs in a transaction after a backup, so the database stays as it was |
| mpv or ffmpeg missing, or keeps crashing | The library stays usable. Playback shows the error and the path it looked at |
| No lyrics, offline, or no waveform yet | An empty state or placeholder, never an error |
| A React feature throws | An error boundary around each feature: that panel shows "Try again", audio keeps playing |
| The renderer process crashes | Reload it. If it keeps crashing, a dialog offers Reload or Quit |
| Anything unexpected | Logged to a file with Reveal log in Settings. A toast, not a white screen |

**How the code does it:**
- **Expected failures are return values, unexpected ones are exceptions.** Functions that can fail in a known way return `Result`, so TypeScript forces the caller to handle it. Exceptions only mean a bug, and are caught at the top of each process.
- **Every command crossing IPC returns a `Result`,** so the UI always gets a typed error with a user-readable message, not a stack trace.
- **Outside data gets validated once, at the edge.** Tags, CUE files, LRCLIB responses and mpv messages go through zod or a parser, and become clean domain types. Past that edge, code doesn't re-check what's already been checked.
- **Null handling is enforced by the compiler.** `strict` + `noUncheckedIndexedAccess` make `array[0]` possibly undefined. Domain types use `null` for "no value", never `undefined`.
- **Every list and async view has four states:** loading (skeleton), error (with an action), empty (with a next step, e.g. "No playlists yet"), and data. An empty array is a normal case, never a crash.

**Deterministic where possible:**
- Logic is pure functions: queue moves, gapless window, CUE and LRC parsing, rescan matching, EQ curves. They take data and return data, and are trivial to test.
- SQLite calls are synchronous, so there's no async around database reads in the main process.
- Async only where the outside world forces it: IPC to the renderer, the mpv connection, the filesystem, the network, workers. It stays at the edges, and the core in the middle is plain synchronous code.

**Module size:** split by responsibility, one job per module, with a 200–300 line trigger. No catch-all files. But a module that really does one job can be longer: splitting just to hit a line count creates functions you have to read together anyway.

## Build order

Each phase ends with something runnable and a commit boundary. "Go wild" (2026-10-30) means I build straight through and you review it all, with the phases as review points.

| # | Phase | Done when |
| --- | --- | --- |
| 0 | **mpv spike** | ✅ [Results](spike-results.md) |
| 1 | **Skeleton** | Repo, conventions, lint boundaries, token system, typed IPC, an empty window that scales from 10" to 65" |
| 2 | **Library** | Point at a folder, scan with progress, browse, search, art showing, Settings → Storage. Run read-only against the real library |
| 3 | **Playback** | The Player module. Now-playing view, queue, gapless, ReplayGain, seek, volume, exclusive toggle, crash recovery |
| 4 | **Playlists** | Create, rename, delete, reorder. Missing tracks handled. Reveal in Explorer |
| 5 | **Input + windows** | Media overlay, hotkeys, context menu, multi-select, touch, TV focus states, mini player |
| 6 | **Extras** | Waveform, CUE, parametric EQ, lyrics (imported from `lyrics-library/`, with a per-track timing nudge), stats |
| 7 | **Package** | An installer I can put on every machine. `resources/icons/` ships beside `resources/mpv/`: `main/index.ts` reads the thumbar icons from `process.resourcesPath/icons` |

## Testing

- **Unit:** CUE parser, LRC parser, queue and gapless-window logic, rescan reconciliation (moved, missing, retagged), migrations, EQ curves.
- **Integration:** the whole Player against a fake mpv (`player.test.ts`: stale and out-of-order events, crashes, races, the failure table, rapid commands), against real mpv with `--ao=null` (`player.mpv.test.ts`), and CUE ranges with rows put in by hand on a real database (`player.cue.test.ts`).
- **Byte-level audio:** gapless and ReplayGain through mpv's PCM writer on generated tracks, the method from the spike, through the whole Player (`player.bytes.test.ts`). The writer runs far faster than real time, and it truncates its file every time the output reopens, so a run stays in one output or uses a file per run.
- **Smoke:** Playwright launches the built app and plays a small generated file, silently.
- **The whole path in the UI:** `tests/e2e/browse.spec.ts` on a library generated with ffmpeg and cached in `.dev/fixtures`. It writes the screenshots to look at into `.dev/screenshots/phase2/`. It resizes the real window, because `page.setViewportSize` leaves the title bar's `env()` values behind. `tests/e2e/listKeyboard.spec.ts` does the same for what jsdom can't see: tab order, focus rings, real scrolling, and sizes changing behind a list.
- **The Player in the app:** `tests/e2e/player.spec.ts` runs it through real Electron and IPC with `--ao=null`, on a small generated library.
- **Playing through the UI:** `tests/e2e/playback.spec.ts` on the generated library: rows, the transport, the art, the queue, every window size, a killed mpv, and an output and an engine that fail. It writes screenshots to `.dev/screenshots/phase3/`. Fingers go in over CDP, because Playwright only offers touch on a page it made itself.
- **Playlists through the UI:** `tests/e2e/playlists.spec.ts`: making them, the drag by mouse and finger, missing tracks and a relaunch. Screenshots go to `.dev/screenshots/phase4/`.
- **Real library:** `MUSIC_PLAYER_REAL_LIBRARY='D:\Music'` turns on `library/realLibrary.test.ts` (the scan, with counts, a spread of files checked against ffmpeg, query timings and the art pass), `tests/e2e/realLibrary.spec.ts` (the same through the whole app), `tests/e2e/realLibraryUi.spec.ts` (frame times while scrolling, and screenshots), `playback/player.realFiles.test.ts` (the spike's two files through the Player, byte for byte), `tests/e2e/playerRealLibrary.spec.ts` (latency, a queue of everything, CPU, on a copy of the database) and `tests/e2e/playbackRealLibrary.spec.ts` (real albums playing, with screenshots in `.dev/screenshots/phase3/real/`, and frame times and real wheel input while scrolling Tracks). Read-only on the folder. Results go to `.dev/real/`.
- **Me:** how it looks and sounds.

Tests never play audible sound, and never write to my music folder. Plus `tsc`, ESLint with the import boundaries (which also fails on `useEffect` in component files), and Prettier.

## Git

Small commits, one per logical change, with a clear point to review at the end of each phase. Claude commits; I push.
