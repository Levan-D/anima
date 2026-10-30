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
      NowPlaying/  Library/  Search/  Queue/  Playlists/  Lyrics/
      Equalizer/  Waveform/  Stats/  Settings/  MiniPlayer/
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

**The window:** my app holds the real queue. mpv only ever holds current + next, kept in sync by `gaplessWindow`, a pure function from queue state to the entries mpv should have. `playlist_entry_id` from `loadfile` replies maps mpv entries back to queue items, so a transition can't be misread.

**Stale events:** every load bumps `loadId`. Position events are ignored between a load and its `file-loaded`.

**CUE tracks** are time ranges inside one playing file. The next track in the same file, when contiguous, is not a reload: `Player` watches position and moves the queue index when it crosses the boundary. Non-contiguous means a real seek or load, with `end=` set when the next track isn't contiguous at load time.

**Failures**, told apart by `file_error`:
- `loading failed`: the file is gone or broken. Mark it missing, toast, skip. Stops after trying the whole queue.
- `audio output initialization failed`: the device is the problem, not the track. Don't skip. If exclusive, fall back to shared and resume, with a toast. If shared also fails, show the error with Retry.
- mpv process exits unexpectedly: restart, restore volume, EQ and output mode, reload, seek back. Automatic restarts stop after 3 quick failures.

## Where data lives

| Data | Location | Why |
| --- | --- | --- |
| Library index, playlists, fetched lyrics, stats, waveforms | `<music folder>/.player/library.db` | Travels with the copy |
| Library path, volume, output mode, window position, EQ | `%AppData%` settings file | Per machine |
| Album art cache | `%AppData%` cache | Rebuildable, no reason to copy |
| Logs | `%AppData%` | Per machine |

For development and tests only, `MUSIC_PLAYER_DATA_DIR` overrides the `.player` location, and `MUSIC_PLAYER_MPV_ARGS` appends mpv arguments (`--ao=null`), so nothing writes to the music folder or makes a sound. `scripts/dev-env.sh` sets both, and points tool caches and temp files inside `.dev/` as well. `npm run dev` passes its own `--user-data-dir`.

**Settings → Storage shows:** library folder and db path, each with a Reveal button · db and cache sizes · track, album and missing counts · last scan time · **"Library last changed on `<machine>` at `<time>`"** · mpv and ffmpeg versions and paths · Reveal log.

On startup, if the db was last changed on another machine, a one-line notice says so. It doesn't try to merge: copying from the main machine is the whole sync model.

## Database schema

The source of truth is `src/main/db/migrations/`. Conventions: all paths are relative to the music folder. Migrations are numbered SQL files tracked with `PRAGMA user_version`, and a run is backed up first. `foreign_keys = ON`, `journal_mode = WAL`, and a checkpoint on clean exit so the `.db` is complete before a copy.

- `files`: one row per audio file. `rel_path`, `size_bytes`, `mtime_ms`, `audio_hash`, format fields, `art_hash`, `missing_since`.
- `tracks`: what I browse and play. A normal file is one track (`cue_index` 0). A CUE album is one file with many tracks, each a time range.
- `artists`, `albums`: grouped by album artist, falling back to artist. Album is unique per artist and title.
- `genres`, `track_genres`: a track can have several.
- `art`: hash-keyed, remembers where each image came from so the cache can rebuild on any machine.
- `playlists`, `playlist_items`: items have their own id, so the same track can appear twice. `position` is rewritten in one transaction on reorder.
- `lyrics`: one-to-one with tracks, so no join table. `not_found` stops re-asking LRCLIB every play.
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
- **Embedded and `.lrc` lyrics aren't stored:** read when playing, in the order `.lrc` → embedded → `lyrics` table. My files are the source of truth, so foobar edits always win.

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
| 6 | **Extras** | Waveform, CUE, parametric EQ, lyrics, stats |
| 7 | **Package** | An installer I can put on every machine |

## Testing

- **Unit:** CUE parser, LRC parser, queue and gapless-window logic, rescan reconciliation (moved, missing, retagged), migrations, EQ curves.
- **Integration:** the mpv client against a fake connection (out-of-order and stale events, crash mid-play), and against real mpv with `--ao=null`.
- **Byte-level audio:** gapless through mpv's PCM writer on generated tracks, same method as the spike.
- **Smoke:** Playwright launches the built app and plays a small generated file, silently.
- **Me:** how it looks and sounds.

Tests never play audible sound, and never write to my music folder. Plus `tsc`, ESLint with the import boundaries (which also fails on `useEffect` in component files), and Prettier.

## Git

Small commits, one per logical change, with a clear point to review at the end of each phase. Claude commits; I push.
