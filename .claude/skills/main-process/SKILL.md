---
name: main-process
description: Use when writing or reviewing code in src/main or src/preload. mpv and Player rules, IPC handlers, SQL, workers, security, settings and the library scanner.
---

# Main process conventions

Read `docs/PLAN.md` ("The Player", "Where data lives", "Database schema", "Error handling and states") and `docs/spike-results.md`. Library notes: `docs/research/electron.md`, `mpv-ipc.md`, `mpv-options.md`, `sqlite-metadata.md`.

## Module shape

Deep modules with a small surface. `index.ts` only wires things together. Pure logic sits in its own file with tests beside it, and the module around it does the I/O. No `service → repository → dao` chains. A module that needs a query owns it or calls `db/`.

## IPC

- Every command and event is defined in `shared/ipc/contract.ts`. Handlers bind in `main/ipc.ts`.
- Validate input with the contract's zod schema, and check the sender frame's origin. The renderer is untrusted.
- Every handler returns a `Result`. Unexpected throws are caught at the IPC edge, logged, and become `{ code: 'unexpected' }`.
- **The renderer never sends a path.** Commands take ids, and main resolves them.
- Don't expose `ipcRenderer` through the bridge, and wrap callbacks so the event object never crosses it.

## Preload

One sandboxed CommonJS file, bundled. In Electron 45 a sandboxed preload has no `Buffer`, `events`, `timers`, `url`, `setImmediate`. It may import `electron` and `shared/ipc/channels.ts`, and nothing else with a runtime dependency.

## mpv and the Player

- Only `main/playback/` knows mpv exists. Nothing else sees mpv names.
- The connection is `child.stdio[3]` from `spawn(mpv, ['--input-ipc-client=fd://3', …], { stdio: ['ignore', 'ignore', 'ignore', 'overlapped'], windowsHide: true })`. Never a named pipe.
- `--no-config` always. Options go in the fourth `loadfile` argument, with index `-1`.
- Use `playlist_entry_id` to map mpv entries to queue items. Never infer from order or filenames.
- `gapless-audio=weak`, never `yes`.
- Clamp seeks: seeking past the end is an error in mpv.
- `af-command <label> <cmd> <value> Parsed_<filter>_0`. One filter per label. Its values don't survive a seek or a new file, because mpv rebuilds filters from the `af set` text, so `af set` has to follow once the values stop moving.
- Exclusive toggle: `set_property audio-exclusive`. No `ao-reload`.
- To move a loaded range's end at runtime, set `file-local-options/end`. A plain `end` carries over to later files.
- `file_error` tells a bad file (`loading failed`) from a bad device (`audio output initialization failed`). A device failure never skips the track. Only `loading failed` marks a track missing: any other file error skips with a notice, because the file is there.
- Log text is for humans. Never parse it for behavior.
- Keep pure logic pure: queue moves, gapless window, CUE boundaries and transition decisions take data and return data. `Player` does the I/O around them.
- Tests use `--ao=null` or `--ao=pcm`. Never audible.

## SQL

- Plain SQL with `better-sqlite3`, no ORM. It's synchronous, so these functions aren't async.
- Migrations are numbered `.sql` files, never edited once committed. Back up, then run inside a transaction.
- Prepared statements cached per connection, parameters always bound, never string-built. FTS queries are sanitized.
- Use `db.transaction()` for multi-statement writes. Never `await` inside one.
- Row types describe the columns, and mapping to domain types happens once in the query module.
- Paths in the database are relative to the music folder, always with one separator style.
- Open with `foreign_keys = ON`, `journal_mode = WAL`, and checkpoint on clean exit.
- Other modules reach the library's database through `Library`, never a raw connection. `library.read` is for reads, and flips the status when it hits corruption. `library.perConnection(create)` builds prepared statements once per connection. `library.onStatus(listener)` says when the library opens, closes or breaks.

## Workers

- Slow jobs (scan, art, waveforms) run in `worker_threads`, imported with electron-vite's `?modulePath`.
- A worker that uses the database opens its own connection. Never share one across threads. `art.worker` has none by design: main hands it sources and saves what it finds.
- A worker can't import `electron`, so nothing that imports `system/logging` either. Errors go back to main as messages, and main logs them.
- Keep write transactions small, so main never waits long on the lock.
- `music-metadata` parses one file at a time, awaited. Its docs warn that parallel parsing can hang.
- Workers post progress and results as typed messages, and support cancelling.
- One bad file never stops a job: record it in `scan_issues` and carry on.

## Files

- `D:\Music` is read-only except for `<music folder>/.player/`. Nothing here renames, moves, tags or deletes audio. Reveal in Explorer is the only file action.
- Honor `MUSIC_PLAYER_DATA_DIR` for the `.player` location.
- Write settings atomically: temp file, then rename.
- Decode text files (CUE, LRC) as UTF-8 with a BOM check, falling back to windows-1252. Real-world CUE files aren't always UTF-8.

## Security

- `contextIsolation`, `sandbox` on; `nodeIntegration`, `webviewTag` off; `webSecurity` on.
- Deny navigation (`will-navigate`, plus a `did-navigate` guard, since a page can leave for `about:blank` without firing `will-navigate`) and new windows (`setWindowOpenHandler`).
- Deny all permission requests except what the app needs (the silent audio element needs none).
- Production renderer is served from `app://` through `protocol.handle`, with the path guarded against escaping the bundle. Never `file://`.
- `art://` takes a hash validated by regex, never a path.
- CSP on in production.
- `shell.openExternal` isn't used. `showItemInFolder` only with paths main resolved itself.
- Fuses at packaging: `runAsNode` off, `enableNodeOptionsEnvironmentVariable` off, `enableNodeCliInspectArguments` off for packaged builds used by me, `grantFileProtocolExtraPrivileges` off. (Playwright needs inspect arguments, so e2e runs against the unfused build.)

## Windows and OS

- `app.requestSingleInstanceLock()`. The database and audio device assume one instance. A second launch focuses the first.
- `app.setAppUserModelId` before any window, matching the installer's `appId`.
- Don't register media keys with `globalShortcut`: it removes the overlay session. See the spike results.
- Pass `defaultPath` to dialogs explicitly. Electron 43 changed the default to Downloads.
- Start long-lived child processes after the first window load. A spawn hands the child every inheritable handle, including Chromium's channel to a renderer being launched, and a copy of that in the child hides `render-process-gone`.

## Logging

`electron-log` in main only. Don't call `log.initialize()`, since it injects a preload. Renderer errors arrive through an IPC command. Catch `uncaughtException`, `unhandledRejection`, `render-process-gone` and `child-process-gone`. Log with context and never log file contents.
