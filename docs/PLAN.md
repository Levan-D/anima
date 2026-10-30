# Build plan (proposal, 2026-10-30)

Claude builds, I criticize. This covers the repo, the architecture, the schema and the build order. Features are in [FEATURES.md](FEATURES.md).

## The four rules that prevent spaghetti

1. **Only `main/playback/` knows mpv exists.** No mpv property name or command appears anywhere else. Swapping the engine would touch one folder.
2. **The main process owns all state.** Queue, playback, playlists and settings live there. Every window (main, mini player) is just a view: it sends commands and renders events. React never decides what plays next.
3. **One typed contract between main and renderer.** `shared/ipc.ts` lists every command and event. Each one is defined once, and both sides get their types from it.
4. **Dependencies point one way, and lint enforces it.** Renderer: `app → features → components/ui → lib`. Features don't import other features. Renderer and main can only share `shared/`. A violation fails lint, so the structure can't rot quietly.

From my Philosophy of Software Design notes:
- **Deep modules:** `Player`, `Library` and `Database` have small interfaces hiding a lot of work.
- **Information hiding:** rule 1.
- **No pass-through layers:** no `service → repository → dao` chains that only forward calls. A module talks to SQLite directly.
- **Split by knowledge, not by time:** the scanner is one module, not `readStep` / `parseStep` / `saveStep`.

## Stack

| Piece | Choice | Why |
| --- | --- | --- |
| Shell | Electron 45 + electron-vite 6 | Decided. Spawns mpv, real filesystem access |
| UI | React 19, Vite 8, Tailwind 4, `motion`, `lucide-react` | Same as Smash Patty |
| Playback state | Zustand | Small, selector-based, so position ticks only re-render what reads them |
| Database reads | TanStack Query | Caching and invalidation; main sends a "library changed" event and the UI refetches |
| Long lists | `@tanstack/react-virtual` | The media list can be tens of thousands of rows |
| Database | `better-sqlite3` + plain SQL, **no ORM** | The schema is the design; it's fast and FTS5 is included. SQL stays readable, and I can defend it |
| Tags | `music-metadata` | Reads tags, embedded art, FLAC audio MD5 |
| Audio | bundled `mpv.exe`, `ffmpeg` for waveforms | Engine decision B |
| Tests | Vitest, Playwright for an Electron smoke test | See Testing |
| TypeScript | Newest version `typescript-eslint` supports | Smash Patty had to pin 6 because of this; recheck at scaffold |

## Repo layout

Own repo at `Documents/GitHub/music-player`. Docs live in `docs/`.

```
src/
  shared/                  imported by both sides, no Node or React
    ipc.ts                 every command and event, with types
    domain.ts              Track, Album, Playlist, PlayerState…
    result.ts              Ok | Err for expected failures
  main/
    index.ts               app lifecycle and wiring, nothing else
    ipc.ts                 binds shared/ipc.ts to the modules below
    playback/              Player: mpv process, pipe client, queue, gapless window, EQ
    library/               scanner (worker thread), reconcile, CUE parser, art extraction
    db/                    connection, migrations/*.sql, queries grouped by table
    lyrics/                sidecar + embedded + LRCLIB lookup
    waveform/              ffmpeg decode to peaks
    stats/                 listening log and rollups
    settings/              per-machine settings file
    system/                media keys, tray, windows, reveal in Explorer, art:// protocol
  preload/
    index.ts               exposes the typed api; nothing else reaches Node
  renderer/
    app/                   root, providers, window routing (main vs mini)
    features/
      NowPlaying/  Library/  Queue/  Playlists/  Lyrics/
      Equalizer/  Waveform/  Stats/  Settings/  MiniPlayer/
    components/ui/         Button, Text, Slider, ContextMenu, Toast… (knows nothing about music)
    hooks/                 generic hooks only
    lib/                   cn, api client, formatters
    styles/                globals.css, typography.css
resources/                 mpv.exe, ffmpeg.exe, pinned versions
.claude/skills/            conventions below, adapted for this repo
```

## Conventions

Inherited so I don't have to repeat them. These go in the new repo's `CLAUDE.md` and skills.

**From Smash Patty:**
- Three-layer tokens (primitives → semantic → utilities). Components never use a primitive.
- **One fluid unit with a floor and no ceiling, following the shorter screen axis.** This is the 10" → 65" answer: everything scales from `--spacing-cell`, with a 44px floor on tap targets. CSS only sees pixels, not inches, so it's tuned to each screen's resolution and Windows scaling.
- Screen-size differences are CSS, never JS. Flex only, no grid.
- `<Text>` owns typography, `<Button>` owns button styling.
- Named exports. `type`, not `interface`. No `Type` suffix. No `enum`. No `any`, `unknown` + guards at boundaries.
- `useEffect` only inside named hooks. No nested ternaries. Motion durations are tokens.

**From Redflag:**
- Features own their UI, hooks and queries. The UI-library test decides what goes in `components/ui`.
- Loading and error are early returns before the main JSX. Skeletons for async sections.
- "Default to no comment": only where a reader would otherwise get it wrong.
- If placement isn't obvious, ask.

**From Vercel's `vercel-react-best-practices` skill** (install in the app repo at Phase 1):
- Applies: the re-render, rendering, client and JS performance rules. The seekbar, for example, keeps position in a ref and writes directly to the DOM instead of re-rendering React on every frame (`rerender-use-ref-transient-values`).
- Ignored: `server-*`, hydration and `async-api-routes`. This app has no server rendering.
- My repo conventions win if the two ever conflict.

**Library docs come first:**
- Before writing against a library, read its docs for the installed version, not memory. Some of these versions are newer than what Claude was trained on.
- mpv options and IPC commands get checked against the manual for the bundled build.
- Follow each library's recommended patterns, including Electron's security checklist. Any deliberate deviation gets a short comment saying why, and a mention at the phase review.
- If the docs don't settle how something behaves, a test or the spike does. Guesses don't ship.

**New for this repo:**
- `contextIsolation` on, `sandbox` on, `nodeIntegration` off.
- Slow work never runs on the main thread. The scanner and waveforms use workers, because `better-sqlite3` is synchronous and a long query would stall mpv control and media keys.
- Art reaches the UI through an `art://` protocol, never base64 over IPC.

## The Player interface

The boundary everything else depends on. Commands return promises, state arrives as events, and nothing exposes mpv.

```ts
type PlayerState = {
  loadId: number; // bumps on every load; stale events get dropped
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'error';
  track: Track | null;
  positionMs: number;
  durationMs: number;
  volume: number;
  outputMode: 'shared' | 'exclusive';
  queue: QueueItem[];
  queueIndex: number;
};

type Player = {
  play(items: QueueItem[], startIndex?: number): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
  setOutputMode(mode: 'shared' | 'exclusive'): Promise<Result<void, OutputError>>;
  setEq(bands: EqBand[]): Promise<void>;
  enqueue(items: QueueItem[], where: 'next' | 'end'): void;
  removeFromQueue(index: number): void;
  moveInQueue(from: number, to: number): void;
  getState(): PlayerState;
  subscribe(listener: (state: PlayerState) => void): () => void;
};
```

Expected failures aren't exceptions. A missing file makes the queue skip it and flag it. A busy device returns an error, and the app falls back to shared mode with a toast. mpv crashing is handled inside `Player`: restart, reload, seek back. The UI just sees a short `loading`.

## Where data lives

| Data | Location | Why |
| --- | --- | --- |
| Library index, playlists, fetched lyrics, stats, waveforms | `<music folder>/.player/library.db` | Travels with the copy |
| Library path, volume, output mode, window position, EQ | `%AppData%` settings file | Per machine |
| Album art thumbnails | `%AppData%` cache | Rebuildable, no reason to copy |

**Settings → Storage shows:** library folder and db path, each with a Reveal button · db and cache sizes · track, album and missing counts · last scan time · **"Library last changed on `<machine>` at `<time>`"** · mpv and ffmpeg versions and paths.

On startup, if the db was last changed on another machine, a one-line notice says so. It doesn't try to merge: copying from the main machine is the whole sync model.

## Database schema

Conventions: all paths are relative to the music folder. Migrations are numbered SQL files tracked with `PRAGMA user_version`. `foreign_keys = ON`, `journal_mode = WAL`, and a checkpoint on clean exit so the `.db` is complete before a copy.

```sql
CREATE TABLE library_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- One row per audio file on disk.
CREATE TABLE files (
  id            INTEGER PRIMARY KEY,
  rel_path      TEXT NOT NULL UNIQUE,
  size_bytes    INTEGER NOT NULL,
  mtime_ms      INTEGER NOT NULL,   -- unchanged size + mtime = skip re-reading tags
  audio_hash    TEXT,               -- hash of the audio only, not the tags; survives retagging and moves
  codec         TEXT NOT NULL,
  sample_rate   INTEGER,
  bit_depth     INTEGER,
  channels      INTEGER,
  duration_ms   INTEGER NOT NULL,
  missing_since INTEGER             -- NULL = present
);

CREATE TABLE artists (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE albums (
  id        INTEGER PRIMARY KEY,
  artist_id INTEGER NOT NULL REFERENCES artists(id),  -- album artist, else artist
  title     TEXT NOT NULL COLLATE NOCASE,
  year      INTEGER,
  art_hash  TEXT,
  UNIQUE (artist_id, title)
);

-- What I actually browse and play. A normal file is one track (cue_index 0).
-- A CUE album is one file with many tracks, each a time range.
CREATE TABLE tracks (
  id           INTEGER PRIMARY KEY,
  file_id      INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  cue_index    INTEGER NOT NULL DEFAULT 0,
  start_ms     INTEGER NOT NULL DEFAULT 0,
  end_ms       INTEGER,             -- NULL = end of file
  title        TEXT NOT NULL,
  artist_id    INTEGER NOT NULL REFERENCES artists(id),
  album_id     INTEGER REFERENCES albums(id),
  disc_number  INTEGER,
  track_number INTEGER,
  UNIQUE (file_id, cue_index)
);
CREATE INDEX tracks_album  ON tracks (album_id, disc_number, track_number);
CREATE INDEX tracks_artist ON tracks (artist_id);

CREATE TABLE genres (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);
CREATE TABLE track_genres (           -- a track can have several genres
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  genre_id INTEGER NOT NULL REFERENCES genres(id),
  PRIMARY KEY (track_id, genre_id)
);

CREATE TABLE playlists (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE playlist_items (         -- own id: the same track can appear twice
  id          INTEGER PRIMARY KEY,
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  track_id    INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL        -- rewritten in one transaction on reorder
);
CREATE INDEX playlist_items_order ON playlist_items (playlist_id, position);

CREATE TABLE lyrics (                 -- one-to-one, so no join table
  track_id   INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
  status     TEXT NOT NULL CHECK (status IN ('found', 'not_found')),
  synced_lrc TEXT,
  plain_text TEXT,
  fetched_at INTEGER NOT NULL         -- not_found stops re-asking LRCLIB every play
);

CREATE TABLE waveforms (
  file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
  peaks   BLOB NOT NULL               -- ~2,000 peaks; CUE tracks read a slice
);

CREATE TABLE play_events (
  id           INTEGER PRIMARY KEY,
  track_id     INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  played_at    INTEGER NOT NULL,
  listened_ms  INTEGER NOT NULL
);
CREATE INDEX play_events_track ON play_events (track_id);
CREATE INDEX play_events_time  ON play_events (played_at);

CREATE VIRTUAL TABLE tracks_fts USING fts5 (title, artist, album);
```

**How the schema handles what could go wrong:**
- **File disappears:** a rescan sets `missing_since` and deletes nothing. Playlists keep the row, shown in a separate "not on this device" section. It comes back by itself when the file returns. Deleting is only ever a deliberate "Remove missing" action, with a warning.
- **Track identity:** `id` is a plain integer that never changes and means nothing. Artist + album + title is not the identity: retagging would change it, and it isn't guaranteed unique.
- **File moves or gets renamed:** the rescan matches new files against missing ones by `audio_hash`, and updates the path instead of creating a new track. Playlists, lyrics and stats survive. FLAC uses the audio MD5 stored in its header (instant); MP3 hashes the audio frames with the tags skipped. If two files share a hash (duplicates), nothing is matched automatically.
- **Retagged in foobar:** path and `audio_hash` stay the same, so `id` stays and only the tags get re-read.
- **ReplayGain isn't stored:** mpv reads it from the file's tags.
- **Embedded and `.lrc` lyrics aren't stored:** read when playing, in the order `.lrc` → embedded → `lyrics` table. Your files are the source of truth, so foobar edits always win.

## Build order

Each phase ends with something I can run and criticize. Nothing moves on until the last one is OK.

| # | Phase | Done when |
| --- | --- | --- |
| 0 | **mpv spike** | The checklist in FEATURES.md is answered on my real DAC. Anything failing changes this plan before it costs anything |
| 1 | **Skeleton** | Repo, conventions, lint boundaries, token system, typed IPC, an empty window that scales from 10" to 65" |
| 2 | **Library** | Point at my folder, scan with progress, browse, search, art showing, Settings → Storage. Run on my real library |
| 3 | **Playback** | The Player module. Now-playing view, queue, gapless, ReplayGain, seek, volume, exclusive toggle, crash recovery |
| 4 | **Playlists** | Create, rename, delete, reorder. Missing tracks handled. Reveal in Explorer |
| 5 | **Input + windows** | Media keys and overlay, hotkeys, context menu, multi-select, touch, TV focus states, mini player |
| 6 | **Extras** (any order) | Waveform, CUE, parametric EQ, lyrics, stats |
| 7 | **Package** | An installer I can put on every machine |

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
| mpv or ffmpeg missing, or keeps crashing | The library stays usable. Playback shows the error and the path it looked at. Automatic restarts stop after 3 quick failures |
| No lyrics, offline, or no waveform yet | An empty state or placeholder, never an error |
| A React feature throws | An error boundary around each feature: that panel shows "Try again", audio keeps playing |
| Anything unexpected | Logged to a file with Reveal log in Settings. A toast, not a white screen |

**How the code does it:**
- **Expected failures are return values, unexpected ones are exceptions.** Functions that can fail in a known way return `Result`, so TypeScript forces the caller to handle it. Exceptions only mean a bug, and are caught at the top of each process.
- **Every command crossing IPC returns a `Result`,** so the UI always gets a typed error with a user-readable message, not a stack trace.
- **Outside data gets validated once, at the edge.** Tags, CUE files, LRCLIB responses and mpv messages go through zod or a parser, and become clean domain types. Past that edge, code doesn't re-check what's already been checked.
- **Null handling is enforced by the compiler.** `strict` + `noUncheckedIndexedAccess` make `array[0]` possibly undefined. Domain types use `null` for "no value", never `undefined`.
- **Every list and async view has four states:** loading (skeleton), error (with an action), empty (with a next step, e.g. "No playlists yet"), and data. Early returns, following the Redflag pattern. An empty array is a normal case, never a crash.

**Deterministic where possible:**
- Logic is pure functions: queue moves, gapless window, CUE and LRC parsing, rescan matching. They take data and return data, and are trivial to test.
- SQLite calls are synchronous, so there's no async around database reads in the main process.
- Async only where the outside world forces it: IPC to the renderer, the mpv pipe, the filesystem, the network, workers. It stays at the edges, and the core in the middle is plain synchronous code.

**Module size:** split by responsibility, one job per module, with the 200–300 line trigger from my conventions. No catch-all files. But a module that really does one job can be longer: per my Ousterhout notes, splitting just to hit a line count creates functions you have to read together anyway.

## Testing

My other repos have no test suite. This one tests the logic that fails quietly and that I can't judge by looking:
- **Unit:** CUE parser, LRC parser, queue and gapless-window logic, rescan reconciliation (moved, missing, retagged), migrations.
- **Integration:** the mpv client against a fake pipe (out-of-order and stale events, crash mid-play).
- **Smoke:** Playwright launches the built app and plays a small test file.
- **Me:** how it looks and sounds, per the build order above.

Plus `tsc`, ESLint with the import boundaries, and Prettier. Lint also fails on `useEffect` in component files, since it belongs in custom hooks.

## Git

Small commits in the app repo, one per logical change, with a clear point to review at the end of each phase.
