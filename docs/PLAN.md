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
    settings/              per-machine settings file
    system/                windows, protocols, security, crash recovery, thumbar, reveal, binaries, logging
  preload/
    index.ts               a single sandboxed CJS file, exposes the typed api
  renderer/
    index.html, main.tsx
    app/                   root, providers, window routing (main vs mini), error boundaries
    features/              one folder per capability
      LibraryGate/  Library/  Search/  ScanProgress/  Settings/
      NowPlaying/  Transport/  Queue/  Playlists/  Lyrics/
      Equalizer/  Waveform/  Stats/  MiniPlayer/
      MediaSession/  Hotkeys/
    components/
      ui/                  Button, Text, Slider, ContextMenu, Toast… (knows nothing about music)
      music/               TrackList, AlbumArt, AlbumCard… (domain parts used by several features)
    hooks/                 generic hooks only
    lib/                   cn, typed api client, player store, query keys, formatters
    styles/                globals.css, typography.css
resources/
  mpv/                     from scripts/fetch-binaries.mjs, not in git
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

**Position** goes out about 5 times a second, and once on pause and seek. While paused, mpv's ticks are ignored: the position only moves by seeking then, and after a seek mpv reports about 190 ms short of it until it resumes.

**CUE tracks** are time ranges inside one playing file. Contiguous ranges are one mpv entry, and `Player` watches position and moves the queue index when it crosses a boundary. A range whose next item isn't contiguous is loaded with `end=` set, and `file-local-options/end` moves it when the queue around it changes, because plain `end` would carry over to later files. Going to another range of the file that's playing is a seek.

**Failures**, told apart by `file_error`:
- `loading failed`: the file is gone. Mark it missing, toast with Reveal, skip. Stops after trying the whole queue, with an error.
- Anything else that isn't the device, such as `unrecognized file format` for a corrupt file: the same, except it's not marked missing, because the file is there.
- `audio output initialization failed`: the device is the problem, not the track. Don't skip. If exclusive, fall back to shared and resume, with a toast. If shared also fails, show the error with Retry.
- mpv process exits unexpectedly: restart, restore volume, mute, ReplayGain and output mode, reload, seek back. Automatic restarts stop after 3 quick failures (under 10 s each), and `player.retry` starts over.

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

**Tags:** `common` is a mix per field, so the edge reads what it can't trust from the block itself. A file with Vorbis comments takes track, disc, date and album artist from them alone: anything else in a FLAC is a leftover. Otherwise track and disc come from APEv2, then ID3v2, then whatever's left. A genre that comes from ID3v2 is read from the raw frame, because the parser eats `Pop (indie)`. Numbers and durations that make no sense stop at this edge.

**Identity:** `tracks.id` survives retags, moves and case-only renames. A new file is a move only if its audio hash matches exactly one row that lost its audio. That's a gone row, or a row whose path now holds different audio, so a swap keeps each id with its recording, and a file moved onto a path that had gone keeps its own id. The row it took the path from goes missing, parked at `.player/displaced/<id>/…`, where the walk can never find a file for it. New audio at a path that matches nothing just updates that row. Rows are never deleted by a scan, except artists, albums, genres and art with no tracks left. A file that won't parse keeps its old row, with its old size and mtime, so it's tried again next scan. `bad_tags` issues carry over between scans for files that weren't re-read.

**Lists leave out missing tracks** everywhere except the `missing` filter and `tracksByIds`. An artist's lists include what they're the album artist of, as well as what they play on.

**Art:** the scanner only records `art` rows (`hash`, where it came from, `mime`). `artCache` on main answers `art://` and decides what to do, and its worker writes `<hash>.<ext>` and `<hash>.thumb.jpg`, and works out `art.color`, which main saves. Nothing is started for a hash the database doesn't know. A color can arrive after a list was read: `library.changed` says so. Hashes are sha1 of the image bytes, so a URL can never change meaning. One image can be embedded in one file and sit in another's folder, so where a file got its art is on the file (`files.art_source`), and that's what says a scan should recheck its folder. A scan also keeps the row's own source current for folder images, and rebuilding tries every file using the image, so a copy with an empty cache doesn't lose art because a folder was renamed. A folder image that can't be read isn't the same as one that's gone: the art stays, with an issue. Pruning the cache keeps everything when the open library has no art at all, since that's more likely the wrong folder than a reason to throw away minutes of work.

**Workers can't see Electron.** `?modulePath` only works in the app, so `index.ts` passes the paths in, and the tests use the in-process runners in `library/testFixtures.ts`. The real worker gets one test of its own, bundled with Vite in `scan.worker.test.ts`.

## The list column

Everything to the right of the art and above the transport, composed in `app/ListColumn.tsx` because it's made of several features.

**What decides what fills the window:** `features/LibraryGate` reads the status. Anything but `ready` gets a screen of its own, with the actions that fix it.

**The cache only hears from main:** `lib/useLibrarySync` is the one subscriber. `library.changed` invalidates by scope, `library.status`, `scan.state` and `settings.changed` go straight into the query cache. Keys are in `lib/queryKeys`, and each starts with its `ChangeScope`, so invalidating the scope reaches them. Nothing refetches otherwise: `staleTime` is `Infinity`. A status that means a different database drops everything under `library`.

**Navigation:** `lib/navigation` holds the tab, a history of what's been drilled into, and the search text. Actions are plain functions, so a row can navigate without subscribing to anything. Search sits over the history rather than in it, until a result is opened: then it goes in, so Back returns to the results. Scroll positions are in `lib/listMemory`, written as a list scrolls and read as it mounts, along with the sizes they were right for, so a size that changes while a list isn't showing still lands on the same rows. A place left by going back or through a tab starts from the top next time. A rebuild or restore starts the navigation over, since the ids in it are from another database.

**Every list is one component:** `components/music/MusicList` takes sections (a grid of albums, rows of tracks, headings) and works out the lanes and the sizes. `components/ui/VirtualList` does the virtualizing, the scroll memory and the keyboard, and knows nothing about music. Row sizes are numbers measured from the fluid tokens by `ListMetricsProbe`, because a `calc()` custom property can't be read as one. Tabular columns are CSS only, through a container query in `em`, which follows the fluid type.

**The keyboard crosses regions:** Arrow Down or Enter in the search field, or Arrow Down on a tab, goes to the list, and Arrow Up on its first row comes back. `lib/listDom` does this, because those parts can't import each other. Escape, Alt+Left and Backspace (outside a field) go back. A refresh that remounts what has focus, as a new album pushing a card into the next lane does, puts focus back on the same album by its id.

**Scan progress** is the only thing that re-renders on `scan.state`. The list hears about new music through invalidation, at most every 1.5 s, and structural sharing keeps the rows that didn't change.

## The now-playing view

Three features around one store: `features/NowPlaying` is the art pane, `features/Transport` the bottom of the list column, and `features/Queue` a tab, which the list column puts where `features/Library` would otherwise be.

**State:** `lib/playerStore` holds what main last said, fed by one subscription that starts in `main.tsx` before the first render, so a window opening mid-song doesn't paint idle first. Everything reads it through narrow selectors, because a state from main is a new object every time. Commands go through `lib/playerActions` and come back as a new state. The queue is fetched by `queueVersion` with `gcTime: 0`: each version is its own entry, and an old one is megabytes nobody can use.

**Position never goes through React.** `lib/playerPosition` takes `player.position`, and `lib/positionClock`, which is pure, works out where it is between reports. One animation-frame loop runs, only while something is playing, something is listening and the window can be seen, and it calls whoever registered with `usePlayerPosition`, who write to the DOM and say how long until they'd have anything new to show. It sleeps until then, because a frame nobody needs still wakes the GPU. Nobody asks for more than four a second, and whoever's registered paints in the same frame, so the window presents four frames a second while the music plays, whatever is moving: this laptop stalls at 5 to 20 a second ([research/ui-stack.md](research/ui-stack.md)). While it runs the clock only goes forward: a report a little behind is jitter and is ignored, a little ahead is caught up with gently, and far away means something really happened. A seek moves the clock at once, and for half a second after it, a report far from there is one that left main before the seek did. A new `loadId` means zero for a different track and holding still for the same one, and either way it asks main.

**The seekbar** is Radix's slider with the value taken away. `components/ui/LiveSlider` hands it a value no pointer can land on, so it reports every move, even back to where a drag began, and draws the line and the dot itself with transforms. Radix's arrow keys step from the value it holds, so the keys are `Seekbar`'s own: 5 s, and 30 s with Shift or the Page keys. A drag stops listening to the position until it lets go, then seeks once. `Seekbar` is its own component because the waveform takes its place in Phase 6.

**The art** waits to be decoded in an `Image` of its own, then goes in with `decoding="sync"`, fading in over the old one, which stays whole underneath, so the pane never dips towards the background. Under reduced motion there's nothing to fade and no layers either, since an animation of no length still leaves one frame at its start.

**The accent:** `lib/albumAccent` is a pure function in OKLCH. It keeps the hue, gives a washed-out average some chroma back, and lifts the lightness until it reads at 4.5:1 on the lightest surface it can sit on, `--surface-active`. A gray stays gray. No color means the neutral tokens. Both variables are registered with `@property`, so `:root` eases them.

**Playing from a list:** a mouse picks with one click and plays with two, a finger or a pen plays with one tap, and Enter plays. It's one click handler going by `pointerType` and `detail`. The queue becomes that list, from that row. Each row has its own selector for whether it's current, by id, or by place in the queue, where the same track can be twice. A new track re-renders the two rows it concerns, and anything else none, pausing included. The bars are one more thing registered with `usePlayerPosition`, so they move in the seekbar's frames and stop when it does. A CSS animation would have the compositor drawing every refresh for as long as they're on screen, which was a tenth of a core of GPU. One context menu covers a whole list: `components/music/TrackMenu` hangs on a `display: contents` element around it, and the row comes from where the press landed.

**The transport goes by its own width,** in `em`: below 26em the volume, the signal and the exclusive switch fold into a menu, up to 42em they take a row of their own, and from there it's all one row with the signal at the top right. Some parts are in the tree twice for this, and CSS shows one of them. Stacked under the art it's always the one-row layout, which is what `--spacing-transport` measures and what the art's height is worked out from.

## Playlists

`main/playlists/` has its own statements through `library.perConnection`, and reads tracks through `library.read`. Every write ends in `markChanged()` and `library.changed` with `playlists`. A `library` change invalidates the playlists too, since a scan can mark what they show as missing.

**Two orders:** what's stored has missing items where they always were, so they come back in the same place. What's on screen is the playable ones, then "Not on this device". A move from the screen counts among the playable rows, and `placeInPlaylist` turns that into the stored place, so a drag never lands relative to something that isn't showing.

**Each item gets its own `Track` object** in `playlist.get`. IPC keeps a shared object shared, and `playTracks` finds the row by identity, so the same track twice would otherwise always play from the first one. A track that's in twice lights both rows while it plays: main knows the queue's place, not which item it came from.

**The drag** is `components/ui/DragReorder` and `hooks/useDragReorder`, and knows nothing about music: rows carry `data-drag-id`, and it hands back `(ids, toIndex)`, with `toIndex` counted in the list without them. That's what `playlist.moveItems` and `player.moveInQueue` take. A mouse drags from anywhere on a row. A finger only drags from `data-drag-handle`, because on the row it scrolls or long-presses. It captures the pointer on the container, since the row under a finger can be virtualized away. It works out the gap from the rows in the DOM every frame, so it doesn't need to know their sizes.

**"New playlist…"** is one dialog, in `ListColumn`, opened with `askForNewPlaylist`, because a menu item can't hold a dialog that outlives it. `TrackMenu` only asks for the playlists while a menu is open.

## Where data lives

| Data | Location | Why |
| --- | --- | --- |
| Library index, playlists, fetched lyrics, stats, waveforms | `<music folder>/.player/library.db` | Travels with the copy |
| Library path, volume, output mode, window position, EQ | `%AppData%` settings file | Per machine |
| Album art cache | `%AppData%` cache | Rebuildable, no reason to copy |
| Logs | `%AppData%` | Per machine |

For development and tests only, `MUSIC_PLAYER_DATA_DIR` overrides the `.player` location, and `MUSIC_PLAYER_MPV_ARGS` appends mpv arguments (`--ao=null`), so nothing writes to the music folder or makes a sound. `scripts/dev-env.sh` sets both, and points tool caches and temp files inside `.dev/` as well. `npm run dev` passes its own `--user-data-dir`.

**Settings shows:** interface size first, since everything below grows with it · the library folder with a Reveal button, the last scan and its report, and what it couldn't read, as one line per reason until the files are asked for · db path with a Reveal button · db and cache sizes · track, album and missing counts · which machine last changed the library, and when · mpv and ffmpeg versions and paths · Reveal log.

On startup, if the db was last changed on another machine, a one-line notice says so. It doesn't try to merge: copying from the main machine is the whole sync model.

**`lyrics-library/lyrics.db`**, in this repo and out of git because lyrics are copyrighted, holds lyrics for my tracks. They come from LRCLIB's database dump in two steps: `scripts/lyrics-dump/extract.mjs` reads the rows that could match out of the gzipped dump into a small file of its own, which takes at most three passes of about eight to fifteen minutes, and `scripts/lyrics-dump/match.mjs` picks each track's lyrics from that file in a few minutes. Tightening a matching rule only needs `match.mjs`, while accepting more artists, albums or titles needs `extract.mjs` again. Rows carry `audio_hash`, so Phase 6 can import them into the `lyrics` table of any copy of the library. It imports `found` and `instrumental` rows and leaves `not_found` behind, so the app still asks LRCLIB once when I play one of those.

## Database schema

The source of truth is `src/main/db/migrations/`. Conventions: all paths are relative to the music folder. Migrations are numbered SQL files tracked with `PRAGMA user_version`, and a run is backed up first. `foreign_keys = ON`, `journal_mode = WAL`, and a checkpoint on clean exit so the `.db` is complete before a copy.

- `files`: one row per audio file. `rel_path`, `size_bytes`, `mtime_ms`, `audio_hash`, format fields, `art_hash`, `missing_since`.
- `tracks`: what I browse and play. A normal file is one track (`cue_index` 0). A CUE album is one file with many tracks, each a time range.
- `artists`, `albums`: grouped by album artist, falling back to artist. Album is unique per artist and title.
- `genres`, `track_genres`: a track can have several.
- `art`: hash-keyed, remembers where each image came from so the cache can rebuild on any machine.
- `playlists`, `playlist_items`: items have their own id, so the same track can appear twice. `position` is rewritten in one transaction on reorder.
- `lyrics`: one-to-one with tracks, so no join table. `not_found` stops re-asking LRCLIB every play.
- `lyrics_offsets` (added in Phase 6): `track_id` primary key with `ON DELETE CASCADE`, and `offset_ms`. It's separate from `lyrics` because the timing nudge applies to every source, and `.lrc` and embedded lyrics have no row there. Replacing a track's fetched lyrics clears it, since the nudge was for the old timing.
- `waveforms`: per file. Peaks scale with duration so a CUE track still gets a detailed slice.
- `play_events`: the listening log behind stats.
- `scan_issues`: what the last scan couldn't read, and why.
- `tracks_fts`: FTS5 search with diacritics removed and prefix indexes.

**How the schema handles what could go wrong:**
- **File disappears:** a rescan sets `missing_since` and deletes nothing. Playlists keep the row, shown in a separate "not on this device" section. It comes back by itself when the file returns. Deleting is only ever a deliberate "Remove missing" action, with a warning.
- **Track identity:** `id` is a plain integer that never changes and means nothing. Artist + album + title is not the identity: retagging would change it, and it isn't guaranteed unique.
- **File moves or gets renamed:** the rescan matches new files against missing ones by `audio_hash`, and updates the path instead of creating a new track. Playlists, lyrics and stats survive. FLAC uses the audio MD5 stored in its header (instant), falling back to hashing frames if it's unset. MP3 hashes the audio frames with tags skipped. If two files share a hash (duplicates), nothing is matched automatically.
- **Retagged in foobar:** path and `audio_hash` stay the same, so `id` stays and only the tags get re-read.
- **ReplayGain isn't stored:** mpv reads it from the file's tags.
- **Embedded and `.lrc` lyrics aren't stored:** read when playing. Timed lyrics come first wherever they're from: `.lrc`, then timed from the `lyrics` table or LRCLIB, then embedded plain, then plain from the table. Embedded lyrics in my library are never timed, so embedded-first would lose sync on most of the files that have them. Embedded text under 15 words isn't lyrics.

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
