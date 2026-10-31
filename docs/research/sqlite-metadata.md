# Reference notes: better-sqlite3, music-metadata, LRCLIB, ffmpeg filters, ffmpeg-static

## Sources

- https://github.com/WiseLibs/better-sqlite3/releases
- https://raw.githubusercontent.com/WiseLibs/better-sqlite3/master/README.md
- https://raw.githubusercontent.com/WiseLibs/better-sqlite3/master/docs/api.md
- https://raw.githubusercontent.com/WiseLibs/better-sqlite3/master/docs/troubleshooting.md
- https://raw.githubusercontent.com/WiseLibs/better-sqlite3/master/docs/threads.md
- https://raw.githubusercontent.com/WiseLibs/better-sqlite3/master/docs/performance.md
- https://raw.githubusercontent.com/WiseLibs/better-sqlite3/master/docs/compilation.md
- https://raw.githubusercontent.com/Borewit/music-metadata/master/README.md
- https://raw.githubusercontent.com/Borewit/music-metadata/master/doc/common_metadata.md
- https://raw.githubusercontent.com/Borewit/music-metadata/master/doc/architecture.md
- https://lrclib.net/docs (JavaScript shell only; it links to docs.md)
- https://lrclib.net/docs.md
- https://ffmpeg.org/ffmpeg-filters.html (one ECONNRESET, then a successful retry; read in windows at offsets 0, 39420, 139420, 178840, 218260)
- https://github.com/eugeneware/ffmpeg-static (repo page)
- https://raw.githubusercontent.com/eugeneware/ffmpeg-static/master/index.js
- https://raw.githubusercontent.com/eugeneware/ffmpeg-static/master/install.js

Version note: the better-sqlite3 releases page shows v13.0.3 as latest, matching the target. The other docs are master-branch or live pages, not the pinned tags, so music-metadata 12.3.2 and ffmpeg-static 5.3.0 were not checked against them.

## better-sqlite3

### Opening
- `new Database(path, options?)`. `":memory:"` is in-memory. `""` or no argument gives a temporary database. A Buffer from `.serialize()` also opens in memory. The file is created if missing, unless `fileMustExist` is set. Opening is synchronous.

| Option | Default | Notes |
|---|---|---|
| `readonly` | `false` | |
| `fileMustExist` | `false` | Ignored for in-memory, temporary, and readonly connections |
| `timeout` | `5000` ms | Wait on a locked DB before `SQLITE_BUSY` |
| `verbose` | `null` | Function called with every SQL string |
| `nativeBinding` | none | Path to `better_sqlite3.node`, relative to cwd; for bundlers that move JS |

### Pragmas
- `db.pragma(source, options?)` returns row objects. `{ simple: true }` returns the first column of the first row. It throws on failure.
- The docs prefer this over prepared statements for PRAGMA. Examples: `db.pragma('journal_mode = WAL')`, `db.pragma('cache_size', { simple: true })`.

### Transactions: `db.transaction(fn)`
- The wrapper begins a transaction on call and commits when `fn` returns. On throw it rolls back and rethrows.
- A wrapper called inside another becomes a SAVEPOINT. If the inner call throws, it rolls back to its savepoint and rethrows. If the outer call does not catch the error, the outer one rolls back too.
- `.deferred`, `.immediate`, and `.exclusive` issue BEGIN DEFERRED, IMMEDIATE, or EXCLUSIVE. A plain call issues BEGIN. Arguments, return value, and `this` pass through.
- Do not run raw COMMIT or ROLLBACK inside. Async functions do not work, because the commit happens at the first `await`.
- SQLite can roll back by itself (ON CONFLICT, RAISE(), SQLITE_FULL, SQLITE_BUSY). After catching an SQLite error inside a transaction, check `db.inTransaction`. The docs advise rethrowing.

### Statements
- `run()` returns `{ changes, lastInsertRowid }`. Other methods: `get()`, `all()`, `iterate()`, `columns()`, `bind()`, `toString()`.
- `pluck()`, `raw()`, and `expand()` are mutually exclusive toggles.
- `bind()` binds permanently, so per-call params are then not allowed. The docs present it as the optimization for statements run many times with the same params.
- `iterate()`: `all()` is slightly faster when you need every row. On an execution error it throws and closes the iterator. `break` inside `for...of` is shown. `stmt.busy` is true while iterating.
- Params: `?`, `@name`, `:name`, `$name`. Named params can bind from an object.
- Types: NULL to null, REAL to number, INTEGER to number or BigInt, TEXT to string, BLOB to Buffer.
- `db.exec(sql)` runs multi-statement SQL. The docs call it slower and less safe than prepared statements. It stops at the first error and does not roll back.
- Errors are `SqliteError` objects with a `code` string such as `SQLITE_CONSTRAINT_UNIQUE`.
- `safeIntegers()` is not in api.md's Statement method list. docs/integer.md is linked from the README but was not read.
- `db.explain(sql)` was added in v13.0.0 and accepts unbound params.
- `db.close()` returns `this`. Afterward no statements can be created or run. Properties: `open`, `inTransaction`, `name`, `memory`, `readonly`.

**Not settled by docs:** a prepared-statement caching policy. The only repeat-use advice is `.bind()`. The threads example calls `db.prepare(sql)` on every message.

### Backup and serialize
- `db.backup(destination, options?)` returns a Promise. It resolves with a progress object whose `remainingPages` is 0 and rejects with an Error on failure.
- Options: `attached` (name of an attached DB to back up) and `progress({ totalPages, remainingPages })`. The default pace is 100 pages per event-loop cycle. Return a number to change the pace, 0 to pause, or throw to abort.
- Writes from the same connection appear in the backup. Writes from another connection restart it. Closing the parent connection aborts pending backups.
- `db.serialize(options?)` returns a Buffer. `new Database(buffer)` opens it in memory.

### WAL and checkpoints
- Set `db.pragma('journal_mode = WAL')`. The README says it is "not required" but important for performance.
- Caveats: ATTACH atomicity holds per database, checkpoint starvation can occur, and some hardware and system limits apply.
- Starvation needs endless overlapping reads. A DB touched by only one process or thread will not hit it.
- With multiple threads or processes, run `db.pragma('wal_checkpoint(RESTART)')` when the `<db>-wal` file grows too large. The docs' example polls the file size every 5 s with `.unref()`.
- The bundled build sets `SQLITE_DEFAULT_WAL_SYNCHRONOUS=1`, so WAL defaults to synchronous NORMAL. Override with `db.pragma('synchronous = FULL')`.

### worker_threads
- The main thread is fine for most work. Use workers for very slow queries.
- The docs' pattern is a pool sized by `os.availableParallelism()`. Each worker opens its own connection with `require('better-sqlite3')('foobar.db')`, receives `{ sql, parameters }`, and posts back `db.prepare(sql).all(...parameters)`.
- The docs state no rule about sharing one Database object across threads. The example never does.
- v13.0.2 fixed a process abort when worker threads terminate.

### FTS5 and bundled SQLite
- Bundled SQLite is 3.53.4.
- FTS5 is compiled in (`SQLITE_ENABLE_FTS5`), along with FTS3 and FTS4. Other flags listed: JSON1, RTREE, MATH_FUNCTIONS, PERCENTILE, GEOPOLY, COLUMN_METADATA, DBSTAT_VTAB, DESERIALIZE, STAT4, UPDATE_DELETE_LIMIT.
- Also set explicitly: `SQLITE_DEFAULT_FOREIGN_KEYS=1`, `SQLITE_DQS=0`, `SQLITE_DEFAULT_CACHE_SIZE=-16000`, `SQLITE_USE_URI=0`, `SQLITE_THREADSAFE=2`. The docs do not explain the DQS or URI settings.

### Electron, prebuilds, install
- The README and api.md do not mention Electron. troubleshooting.md has an Electron section. It says "If you're using Electron, use electron-rebuild," without a command. For app.asar bundles, native libraries must be unpacked. electron-forge users can use its auto-unpack-natives plugin.
- README: prebuilt binaries exist "for major platforms/architectures." Node.js support is limited to "currently supported" versions.
- v13.0.0 publishes prebuilt binaries inside the package and removes `prebuild-install`. Without a prebuilt for your platform, it compiles during install. The release says prebuilds "should theoretically work" across Node.js and Electron versions.
- So when a matching prebuilt exists, install does not compile and needs no C++ toolchain. The docs do not confirm this for Electron.
- Windows source builds: choose "Automatically install the necessary tools" during Node.js setup, or run `C:\Program Files\nodejs\install_tools.bat`, which installs Chocolatey, Visual Studio, and Python. Keep spaces and `%` or `$` out of the project path. For persistent failures, delete `node_modules` and `$HOME/.node-gyp`, then reinstall.
- Release history for context: v12.10.0 added Node.js 26 prebuilds, removed Node 20 and 23 builds, and temporarily rolled back Electron 42 prebuilds. v12.11.2 added Electron 43 prebuilds. v12.12.0 says Electron 43 Linux binaries need glibc 2.41 or higher. That affects Linux only.

**Not settled by docs:** whether a prebuilt covers Electron 45 on win32-x64. The first page of releases, v13.0.3 back to v12.10.0, names no Electron 45. Whether electron-rebuild is still needed with v13, since troubleshooting still recommends it. The full prebuilt platform matrix. Any Node or Electron minimum change in v13.

### Settled by running 13.0.3 (Phase 2)

- `PRAGMA application_id = N` on an empty file works, and writes page 1 atomically, so set it before `journal_mode = WAL`: there's then never a non-empty file without an id. `PRAGMA user_version = N` inside `db.transaction()` rolls back with it.
- A file that isn't SQLite opens fine, and throws `SQLITE_NOTADB` on the first pragma. Reading pragmas on a too-new WAL database leaves the main file byte-identical, and removes its `-wal` and `-shm` on close.
- `db.prepare('VACUUM INTO ?').run(path)` takes a bound path. It carries over `application_id` and `user_version`, the copy isn't in WAL mode, and writers on another connection carry on while it runs. It refuses a non-empty target.
- `db.pragma('quick_check(1)', { simple: true })` returns `'ok'` or the first problem. Damaged pages can also make it throw `SQLITE_CORRUPT`. It doesn't look inside indexes, so a damaged one passes and queries using it quietly return fewer rows. `integrity_check(1)` does look, and took 30 ms against 21 ms on the real database.
- A file with the read-only attribute opens with no error, and `BEGIN IMMEDIATE` succeeds on it, because SQLite turns that into a read on a read-only database. It takes a real write to find out, such as `PRAGMA user_version = N` in a transaction that's rolled back, which gives `SQLITE_READONLY`.
- `wal_checkpoint(TRUNCATE)` then `close()` on the last connection removes both side files, and the `.db` alone is complete.
- `worker.terminate()` mid-transaction is safe once the binding has loaded: the next open rolls it back, and `integrity_check` passes. Landing while the worker is still loading the binding aborts the whole process with `napi_fatal_error`, main included: 3 of 282 random terminates, all 93-111 ms after start. So give a worker the chance to finish first.
- FTS5's `{a b} : (expr)` and `a : (x AND y)` column filters work on a whole expression. Inside quotes nothing is syntax: `"a""b"*`, `"title:foo"*`, `"NEAR(a"*` are all fine. A phrase with no word characters is the one thing to filter out first.
- `unicode61 remove_diacritics 2` folds ö, ò and ë, but not ø, ß or æ, and splits at all punctuation: `chloe` doesn't find Chløë, and `acdc` doesn't find AC/DC. That's what `searchText` is for.
- Measured on the real database (5,719 tracks, 4.3 MB) on plain Node: all tracks with joins, genres and sorting takes 16 ms, and mapping them to objects 3 ms.

### Version 13 changes
- v13.0.0: first N-API build (node-addon-api refactor). `prebuild-install` removed. New `db.explain()` and `preparedStatement.toString()`. SqliteError cross-realm fix.
- v13.0.1: fixed over-strict parameter binding that rejected plain objects from other realms, such as in Jest.
- v13.0.2: `gypfile` option added to package.json (the notes do not explain it). SQLite updated to 3.53.4. Table-parameter validation. Worker-termination fix.
- v13.0.3: CI runner change only.
- No Node.js or Electron minimum change is named.

## music-metadata

Docs are from master, not checked against 12.3.2.

### Module and runtime
- Pure ESM since version 8. Engine: Node.js 22 or later. From CommonJS, use `await import('music-metadata')`. The README says Node 22 or later can also `require()` it.
- The Node entry exports `parseFile` and `parseStream`. In the browser build, those stubs always throw (architecture.md).

### Functions
- `parseFile(filePath: string, options?: IOptions): Promise<IAudioMetadata>`. The path must be a regular file. Symlinks to regular files are fine. Directories and FIFOs are rejected with `NotRegularFileError` from strtok3, and FIFOs are rejected without waiting for a writer.
- `parseStream(stream: Readable, fileInfo?: IFileInfo | string, options?: IOptions)`. `IFileInfo` has `mimeType`, `size`, and `path`. For duration on streams, the README says to pass `size` in some cases.
- Also `parseBuffer(uint8Array, fileInfo?, options?)`, `parseWebStream(webStream, fileInfo?, options?)`, `parseBlob(blob, options?)`, and `parseFromTokenizer(tokenizer, options?)`.
- Helpers: `selectCover(pictures?)`, `orderTags(nativeTags)`, `ratingToStars(rating)`, `getSupportedMimeTypes()`.
- Error classes: `CouldNotDetermineFileTypeError`, `UnsupportedFileTypeError`, `UnexpectedFileContentError`, `FieldDecodingError`, `InternalParserError`. Treat caught values as `unknown`.
- The README FAQ says to parse file lists one at a time with `await`. Parallel parsing can hang the app.

### IOptions (defaults)
- `duration` (false): may read more of the file to find duration. Duration can still be missing.
- `includeChapters` (false): reads MP4 QuickTime chapter tracks and Nero `chpl` lists. The README says MP4 chapters "still" need this flag. It does not say whether ID3v2 CHAP needs it.
- `maxChapterCount` (1000). `maxMemoryAllocation` (67108864, 64 MiB). `maxMetadataEntries` (100000). `mkvUseIndex` (false, experimental).
- `observer(update: IMetadataEvent)`: runs synchronously after common or format updates. Promises are not awaited. Unchanged primitive format values do not fire it.
- `skipCovers` (false): no embedded art is extracted. MP4 JPEG and PNG bodies are skipped before buffering, so they can exceed `maxMemoryAllocation`.
- `skipPostHeaders` (false): tag headers at the end of the file are not read. The docs call this useful for streams.

### Result shape
- Top level: `format`, `common`, `native` (native tags per format), and `quality.warnings` (each with `message`).
- `common` (table generated from the tag mappers; n = multiplicity):
  - `track` and `disk`: n=1, shaped `{ no, of }`.
  - `albumartist`: n=1. `albumartists`: n=*. `artist`: n=1. `artists`: n=*. Each is filled from the other when its own tag is missing.
  - `genre`: n=*, so multi-valued. The table gives no TypeScript type.
  - `picture`: n=*, described as "Embedded cover art". `IPicture` is `{ format: string; data: Uint8Array; description?: string; type?: string }`.
  - `lyrics`: n=*. Sources: ID3 USLT and SYLT, Vorbis LYRICS and UNSYNCEDLYRICS, iTunes ©LYR, APEv2 LYRICS, ASF WM/Lyrics.
  - `replaygain_track_gain`, `replaygain_track_peak`, `replaygain_album_gain`, `replaygain_album_peak`: n=1, each shaped `{ ratio: number, dB: number }`.
  - `replaygain_track_minmax`, `replaygain_album_minmax`, `replaygain_undo`, `averageLevel`, `peakLevel`: n=1, with no shape given.
- `format` (IFormat): `container`, `codec`, `codecProfile`, `lossless` (boolean), `bitsPerSample`, `sampleRate` (Hz), `numberOfChannels`, `duration` (seconds, optional), `bitrate`, `containerDuration`, `overallBitrate` (needs file size and duration), `trackGain` and `albumGain` (dB numbers, a different type from the common `{ratio, dB}` objects), `tagTypes`, `chapters`.
- `format.trackInfo[]`: each entry has `type` (`TrackType`) and `audio` with `samplingFrequency`, `channels`, `bitDepth`, and `numberOfSamples`. The README selects audio tracks with `TrackType.audio`.

### Cover art and chapters
- `selectCover(common.picture)` returns the picture whose `type` matches, otherwise the first picture. It returns `null` when there are none.
- `IChapter` has `title`, `start`, and optional `end` and `timeScale`. An omitted `timeScale` means seconds. ID3v2 CHAP uses seconds, MP4 QuickTime uses its track timescale, and Nero uses 10000000. `sampleOffset` is described as "a separate audio sample position." It is not a timescale.

**Not settled by docs:**
- The `common.lyrics` object shape, including synced vs. unsynced fields. The table lists only sources.
- A byte offset to the audio data. No field is documented.
- The `IMetadataEvent` shape.

**Settled by reading 12.3.2 and running it over all 5,719 real files (Phase 2):**
- **`format.audioMD5` is never set for FLAC.** Only the WavPack parser sets it. The MD5 is in STREAMINFO: after `fLaC` (and any ID3v2 tag in front of it), a 4-byte block header, then 18 bytes, then 16 bytes of MD5. All zero means unset, which real encoders do: 770 of 4,924 files here, from libFLAC 1.2.1 to 1.3.2, Lavf and Mutagen.
- **`format.hasAudio` doesn't mean frames were found.** The MP3 parser sets it true before looking. A file with no audio stream has no `codec` and no `sampleRate`, which is the test to use.
- Garbage doesn't always throw. A `.flac` of 30 bytes of text throws "Invalid FLAC preamble". One of under 10 bytes returns an empty format, because the ID3 peek hits the end first. A zero-length file isn't worth asking about.
- `common.track` and `common.disk` are always there, as `{ no, of }`, with `no` null when unset. A `DISCTOTAL` alone gives `{ no: null, of: 1 }`.
- `common.genre` keeps Vorbis and APE values as written, and semicolons aren't split. **ID3v2 doesn't survive:** the parser takes any `(...)` for an ID3v1 code and drops what it can't map, in `native` as well, so `Electro (Pop)` comes out as `Electro ` and `(Pop)` as nothing at all (278 of my 795 MP3s). The text is only in the raw `TCON` frame. The standard only has references at the start of a value: `(17)`, `(17)Rock`, `(51)(39)`, and `((` for a real bracket.
- `common.year` is `parseInt` of the first 4 characters of the date, so `03/12/2014` gives year 3. `common.date` keeps the original. An ID3v2.3 `TYER` of `2020-03-31` gives year 2020 with no `date`. A `date` sets `year` without going through the priority, so any later block's own year overwrites it: Vorbis `DATE=1997` and an ID3v1 year of 2007 give `date` 1997 and `year` 2007. Believe `date`.
- `common` is a mix per field. Most follow a priority (APEv2, Vorbis, ID3v2.4, ID3v2.3, ID3v2.2, then ID3v1, and a field a higher block lacks comes from a lower one), so a FLAC's album can come from Vorbis and its album artist from a stale ID3v2 block. **`track` and `disk` have no priority at all:** whichever block was parsed last wins. That's ID3v2 over Vorbis in a FLAC (26 files here carry both, and `Rihanna/We Found Love.flac` has `TRACKNUMBER=11` and `TRCK=03/14`), and ID3v1 over APE and ID3v2 in an MP3. `native` has every block apart, with names as written for APE and upper case for Vorbis.
- An MP3 with both APEv2 and ID3v2 (36 here) gets APE's values wherever it has them, where ffmpeg takes ID3v2's. On these files APE is the one that's right: its track numbers are the albums' real ones.
- `common.artist` comes from `ARTIST`/`TPE1` as written. `common.artists` can hold something else entirely (`TXXX:Artists`, `DISCOGS_ARTISTS`). Only if the singular tag is missing does the plural get joined into `artist` with `, ` and ` & `.
- `picture.type` is `'Cover (front)'`, `'Other'` or undefined. `selectCover` takes the first front cover, else the first picture. The largest here was 9.6 MB, well under `maxMemoryAllocation`.
- `quality.warnings` is mostly noise: unknown PRIV owners, and illegal ID3 frame ids in otherwise fine files.
- `parseFile` opens read-only. Speed with covers on, sequential, cached: 16.5 s for all 5,719 files.
- `duration: true` on a CBR MP3 with no Xing header estimates from file size. Against decoding all 230 such files here, the median was 7 ms off, p95 35 ms and the worst 549 ms. On VBR it counts frames and is exact. ffmpeg's own `Duration:` line, when it prints "Estimating duration", was 12 s off on a VBR file where this was right.

## LRCLIB

Base URL `https://lrclib.net`. No key is needed, and CORS is open. The `/docs` page is a JavaScript shell that links to `/docs.md`, which I used. The harness saved the docs.md response as a binary file.

### Identification and rate limits
- Identification is required by policy: "We require you to identify your client." Send a User-Agent naming the app, version, and a homepage or email. Quickstart example: `User-Agent: MyApp v1.0 (https://example.com)`. If a browser blocks the header, use `X-User-Agent` or `Lrclib-Client`.
- Registration is optional. `Lrclib-App-Id` is public and client-side. `Lrclib-Api-Key` is secret and server-side. Invalid values return 401.
- Approximate limits per IP, not a contract:
  - No User-Agent or a common library: about 45 requests/min.
  - Identified User-Agent: about 90 requests/min.
  - Registered `Lrclib-App-Id`: about 180 requests/min, plus about 6,000 requests/min app-wide.
  - Registered `Lrclib-Api-Key`: about 6,000 requests/min app-wide only.
- A 429 body has `name: "RateLimitExceeded"` and `scope` set to `ip` or `application`. Honor `Retry-After`, wait at least that long, and add up to about 30% jitter. Ignoring it can cause a temporary ban.
- Send requests sequentially, with 200 to 500 ms between them, especially for library scans.
- Measured 2026-10-30, 18:00 UTC: `/api/get` answered 503 `ServerOverloaded` with `Retry-After: 1` to 75 to 90% of requests, whether they were 0.7 s or 6 s apart. That's load on the whole service, not this client's pace.
- The server's ARCHITECTURE.md says `/api/get` caches hits and misses for 24 h, so asking again right after a 404 gets the same answer. `/api/get-cached` appears in none of the docs, so don't build on it.

### Database dumps
`/db-dumps` needs JavaScript. On 2026-10-30 it listed one file: `https://db-dumps.lrclib.net/lrclib-db-dump-20261012T090639Z.sqlite3.gz`, 47,837,763,733 bytes (44.6 GiB), resumable (`Accept-Ranges: bytes`). No schema, schedule or uncompressed size is stated. The server code is MIT, and no license is stated for the lyrics.

Measured from that file's header, its schema, and the first 1 GiB of its stream:
- **Size:** 63,905,241 pages of 4096 bytes, so 243.8 GiB unpacked, which is more than this machine can spare.
- **Format:** UTF-8, no reserved bytes, no free pages, no auto-vacuum and so no pointer map pages, schema format 4, WAL-mode header, last written by SQLite 3.49.2. The header's page count is valid: the change counter and version-valid-for are both 1.
- **Objects:** tables `tracks`, `lyrics`, `missing_tracks`, `flags`, `_litestream_lock`, `_litestream_seq`, `sqlite_sequence`, `sqlite_stat1`, `sqlite_stat4`, the FTS5 table `tracks_fts` with its four shadow tables, 18 indexes, and triggers. `set_tracks_last_lyrics_id` sets `tracks.last_lyrics_id` to the newest `lyrics` row of a track.
- **Rows:** `sqlite_stat1` says 32,005,326 in `tracks` and 34,045,072 in `lyrics` at the last ANALYZE. `sqlite_sequence` says the highest ids ever were 39,053,376 and 34,156,316, so ids have gaps: the first 10.7 million track ids hold 5.4 million rows.
- **`tracks`:** `id, name, name_lower, artist_name, artist_name_lower, album_name, album_name_lower, duration FLOAT, last_lyrics_id, created_at, updated_at`, 11 fields in every record seen. 99% of durations in the first GiB are whole numbers stored as integers, 0 and 1 as serial types 8 and 9. About 0.08% have no duration.
- **`lyrics`:** `id, plain_lyrics, synced_lyrics, track_id, has_plain_lyrics, has_synced_lyrics, instrumental, source, created_at, updated_at, lyricsfile, has_lyricsfile, has_word_sync`. The last three came from `ALTER TABLE ADD COLUMN`, so an old row's record can stop at 10 fields, and they read as NULL, 0 and 0. `track_id` comes after the lyric text, so it usually can't be read until the row is whole.
- **Layout:** the start is in rowid order. Root pages 2 to 36 follow the schema, and only the newest index's root, 63,699,444, comes later. Past those roots, the first GiB holds nothing but `tracks`: 261,396 of its 262,144 pages are table leaves, with no spilled rows, and no `lyrics` row. Further on, `lyrics` overflow chains step backward, some of them many times. Following them one backward step a pass, of the 482,652 rows wanted, 275,674 were unfinished after pass 2, 1,119 after pass 3 and 14 after pass 7.
- **Speed:** gunzip gives 193 MB/s with zlib's default 16 KiB chunks and 433 MB/s with 1 MiB chunks, and 4 MiB gains nothing. The first GiB compresses 3.4 to 1 and the whole file 5.5 to 1, and a whole pass took 498 s, about 525 MB/s. Parsing every cell costs next to nothing beside that, and normalizing each track's title about 3 µs a row, or under two minutes for the whole table.

`scripts/lyrics-dump/` reads the rows straight out of the gzip stream, in page order, and writes only the ones that matter. Gzip can't seek, so every read costs a pass, and passes are what it economizes:
- `sqlitePages.mjs` knows the file format and nothing about LRCLIB. `isTableLeafPage` goes by the first byte, because a forward read has no b-tree to walk, and its comment says why that's safe. Pages arrive in order, with `createGunzip` and `pipeline`, so a truncated or corrupt file rejects, and reading to the end proves the gzip CRC and the header's size.
- `overflowChains.mjs` joins spilled payloads back together. The first whole read notes every page's first four bytes, in a 256 MB `Uint32Array`, which on an overflow page are its next-page pointer. That lays out what's left of every chain at once, so one more read collects those pages in any order, however often a chain steps backward. A chain has to end exactly where its payload does. A page claimed twice gives up both rows, even one already kept, but a damaged pointer onto a page no wanted row claims, like an older `lyrics` row's, can't be seen from a forward read. Pieces kept across reads get memory of their own, because Node 24's `Buffer.from` puts anything under 32 KiB in a shared 64 KiB pool, where one small piece pins a whole block: the first real run peaked at 3.8 GB.
- `dumpRows.mjs` tells tables apart by serial types, since a leaf page doesn't say whose it is. `tracks` and `lyrics` share rowid values, so a rowid alone proves nothing, and a kept row's `track_id` has to name the track that points at it.
- `extract.mjs` scans `tracks` once and keeps every row whose title matches the library within 15 s, whatever the artist, along with any other row `lrclib.ts`'s `mayAnswer` accepts for a track: by the same artist, a title a little off at the same length, or the same title at any length. A second pass collects the `lyrics` rows that the rows `mayAnswer` accepts point at, and a third the overflow pages that had gone by when their chain reached them. That's usual for a row that starts a leaf: its overflow pages are written before the leaf splits, so they sit just before it. Each pass commits as it ends. A rerun skips a finished tracks scan, keeps the lyrics it has, and reads what's left in at most two passes. A tracks row whose `last_lyrics_id` spills off its leaf can't be kept, so the 23 in the real file are only counted, with the id and title of any whose title is in the library in `too_long_title_hits`.
- `match.mjs` does the matching against that extract, in a couple of minutes, and refuses a library whose titles, artists or lengths differ from the ones the extract was scanned from. A retagged album passes, since no scan depends on it, and whatever it newly credits counts as not read yet until `extract.mjs` reads it. It counts the records it accepts that have no lyrics row: unreadable, not found in the dump, or not read yet.

How `lrclib.ts` picks a track's record:
- **The same song:** within 2 s of length, a matching title (`normalizeName`, or `baseTitle` on either side, unless both name different parts), and credit: the artist contains or is contained in the tag, whole words, or the record's album contains the tag album, whole words, unless that album is named after the song. Text under 15 words, not counting `[..]` tags and `Artist:`, `Album:` and `Title:` lines, isn't lyrics. Neither is text more than 30% in kana, Han, Hangul, Cyrillic, Arabic or Hebrew letters on a track whose tags use none.
- **Ranking:** instrumental if flagged records outnumber sung ones 7 to 1. Then a finished sync, a partial one, plain, an instrumental flag. Then artist credit, same album, exact name, smallest gap, lowest id. A sync is partial if its last stamp reaches under 85% as far as the furthest sync, if it holds under 70% of the usual word count, or if another sync's words go over 1/0.85 further and number at least 15% more. All of those compare against artist-credited records if any of them has a sync, since a record credited only through its album can be another song.
- **Further out:** a plain pick gives way to a sync within 5 s that holds at least 70% of its words. Only if nothing within 2 s has words does it look out to 15 s and vote again over all of them, keeping sync up to a 5 s gap. A flag or two can't stop that, but where words and flags stand side by side within 2 s and the flags win, the vote stands.
- **Loose readings:** `pickLooseRecord`, for a track nothing above answers, in this order. A title match on an album naming the tag artist, for a soundtrack. The artist and title named in the title tag, as `Artist - Title`. The same artist within 2 s, with a title a typo or two off, or cut short of the other by at least two words. The same artist and normalized title at any length down to a minute shorter than the file, which `lyricsFrom` keeps as plain. These take words only: flags alone leave a track `not_found`. Only `match.mjs` uses them, since `lookup` asks LRCLIB by the tags as they are.

`matched_via` says how a pick's names compare, and nothing about its length, which is `lrclib_duration`: `exact` is the same title, artist and album, `any_album` the same title and artist, `search` a record that only contains the artist or has a dressed-up title, `same_album` a record credited only through its album, and `loose` a loose reading. No search has to have run for `search`. It's for looking into a pick, not for showing.

What a change to `lrclib.ts`'s rules takes:
- Tightening a rule: only `match.mjs`.
- Accepting more artists or albums: `extract.mjs` again. It checks every kept row against today's `mayAnswer` and reads just the new rows' lyrics, with no new tracks scan. Until then `match.mjs` counts those records as not read yet.
- Accepting titles with other keys, a wider `WIDEST_DURATION_SECONDS`, or a loose reading that reaches rows the last scan didn't keep: a new tracks scan, by deleting the extract or writing a new one, about 40 minutes in all. Nothing can warn about this.

### Endpoints
- `GET /api/get`: `track_name` (required), `artist_name` (required), `album_name` (optional, recommended), and `duration` (optional, 1 to 3600). Lyrics come back only when the duration matches within ±2 s. Returns 200 with a record, or 404 `TrackNotFound`.
- `GET /api/get/{id}`: path parameter `id` (number). Returns a record.
- `GET /api/search`: `q` (matches title, artist, or album; takes precedence) or `track_name`, plus optional `artist_name` and `album_name`. With neither `q` nor `track_name`, it returns an empty array. Maximum 20 results, no pagination. Both filters hold (tried 2026-10-31): with `artist_name` every result is by that artist, so a record credited only through its album never comes back, and with `album_name` every result is on that album, whoever the artist.
- `POST /api/publish` (experimental): header `X-Publish-Token`. Required JSON fields: `trackName`, `artistName`, `albumName`, `duration`. Optional: `plainLyrics`, `syncedLyrics`, `lyricsfile`, where `lyricsfile` overrides the other two. If all lyrics are empty, the track is marked instrumental. Success is 201. A bad token returns 400 `IncorrectPublishTokenError`.
- `POST /api/flag`: header `X-Publish-Token`. JSON `trackId` (number, required) and `content` (optional). Success is 201.
- `POST /api/request-challenge` (experimental): returns `{ prefix, target }`, valid for 5 minutes. Solve the proof of work to get a `nonce`. The token is `prefix:nonce` and is single-use.

### Record fields (`/api/get`, `/api/get/{id}`, `/api/search`)
- `id` (number), `name` (alias of `trackName`), `trackName`, `artistName`, `albumName`, `duration` (seconds). In practice `albumName` can be null (9 rows of the extract, and live from `/api/get/4532688`), and so can `duration`: a search result is dropped for that, and a null album reads as an empty one.
- `instrumental` (boolean): the docs say true when there are no lyrics. Not so in the data: 93 of the extract's 21,366 flagged rows carry 15 words or more.
- `plainLyrics` (string or null): null for instrumental records, by the docs.
- `syncedLyrics` (string or null): LRC-formatted with line timestamps. Null for instrumental records, by the docs. Most end on a stamp with no words after it (4,124 of 4,398 picked syncs), so the last stamp isn't where the words stop.
- `hasWordSync` (boolean): true only when `lyricsfile` has word-level timings.
- `lyricsfile` (string): raw Lyricsfile YAML. Always present.

### Errors
- JSON body with `message`, `name`, and `statusCode`.
- 400 `ValidationError` or `IncorrectPublishTokenError`. 401 `InvalidAppIdError`, `MissingApiKeyError`, or `InvalidApiKeyError`. 404 `TrackNotFound`. 429 `RateLimitExceeded`. 500 `UnknownError`. 503 `ServerOverloaded`, retry after `Retry-After`, usually 1 s.
- Malformed or missing query parameters return plain text, not JSON. The docs give no status for this case, so check Content-Type first.

**Not settled by docs:** the not-found status for `/api/get/{id}`, since the 404 row is general. The status for a missing User-Agent, since none is documented. Exact rate limits, which the docs say may change.

## ffmpeg filters

The filter page does not state its FFmpeg version. The ffmpeg-static README says its binaries are 6.1.1. Confirm option names on the bundled binary with `ffmpeg -h filter=<name>`.

### Runtime changes (section 6)
- Options marked `T` in `ffmpeg -h filter=<name>` can change during processing. The command name is the option name, and its argument is the new value.
- The transport, `sendcmd`/`asendcmd` in section 20.18, was not read.

### bass/lowshelf (8.71), treble/highshelf (8.116), equalizer (8.87)
`bass` and `treble` are two-pole shelving filters. `equalizer` is a two-pole peaking filter, and the docs say to chain several for complex curves.

| Option | bass / lowshelf | treble / highshelf | equalizer |
|---|---|---|---|
| `gain` (`g`) | gain at 0 Hz; useful about -20 to +20 dB | gain at the lower of about 22 kHz and Nyquist; useful about -20 to +20 dB | required gain or attenuation in dB |
| `frequency` (`f`) | default 100 Hz | default 3000 Hz | central frequency in Hz; no default stated |
| `width_type` (`t`) | h, q, o, s, k | same | same |
| `width` (`w`) | shelf transition steepness | same | bandwidth in width_type units |
| `poles` (`p`) | default 2 | default 2 | not an option |
| `mix` (`m`) | default 1; range 0 to 1 | same | same |
| `channels` (`c`) | default all | same | same |
| `normalize` (`n`) | default off; sets DC response to 0 dB | same | same |
| `transform` (`a`) | di, dii, tdi, tdii, latt, svf, zdf | same | same |
| `precision` (`r`) | auto, s16, s32, f32, f64 | same | same |
| `block_size` (`b`) | reverse-IIR block; a non-zero value sets delay to exactly that many samples; too small produces artifacts | same | same |
| Runtime commands | frequency, width_type, width, gain, mix | same | same |

- Example from the docs: `equalizer=f=1000:t=h:width=200:g=-10` attenuates 10 dB at 1000 Hz with a 200 Hz bandwidth.

### biquad (8.72)
- Applies an IIR filter from `b0, b1, b2` (numerator) and `a0, a1, a2` (denominator) coefficients. Defaults are not stated.
- Commands: `a0, a1, a2, b0, b1, b2`, described as "Change biquad parameter." The page also lists `mix`, `channels`, `normalize`, `transform`, `precision`, and `block_size` under the same commands heading. It does not separate options from commands there.

### volume (8.120)
- `volume` expression, default `1.0`. Output is clipped to the maximum value.
- `precision`: `fixed`, `float` (default), or `double`.
- `replaygain`: `drop` (default) removes ReplayGain side data without using it. Also `ignore`, `track`, and `album`. `replaygain_preamp` defaults to 0.0 dB. `replaygain_noclip` defaults to 1 and limits applied gain to prevent clipping.
- `eval`: `once` (default) or `frame`.
- Runtime command: `volume`. An invalid expression keeps the current value.

### Gain staging
- The docs warn about clipping with positive gain on equalizer, bass, and treble.
- `normalize` (default off) sets the response at DC to 0 dB. On a literal reading, that conflicts with a nonzero bass gain, which is defined at 0 Hz. The docs do not say how the two combine, so test it.
- `mix` (default 1) controls how much filtered signal reaches the output. Lower values blend in unfiltered signal.
- The sections read describe no headroom or limiter.

**Not settled by docs:** defaults for gain, width, width_type, transform, precision, block_size, and equalizer frequency. How normalize and a nonzero gain interact. Which options the bundled 6.1.1 build has. The syntax of sendcmd, asendcmd, and zmq, which were not read.

## ffmpeg-static

### Install
- `install.js` is the download step. The npm hook that runs it is in package.json, which I did not read.
- If the binary already exists, it prints "is installed already" and exits. If the platform or arch is unsupported, it exits with status 1 and "No binary found for architecture."
- It downloads `<executable-base-name>-<platform>-<arch>.gz` from `<base>/<release>`. The default base is `https://github.com/eugeneware/ffmpeg-static/releases/download`. It gunzips the file, writes it, and runs `chmod 0755`. It also downloads `<platform>-<arch>.README` and `.LICENSE` beside it. A 404 on those is only a warning. Other errors fail the install.
- The release tag comes from `binary-release-tag` in package.json and can be overridden by an env var. The base URL has an env override too. The names are in package.json.
- Proxy support: `HTTPS_PROXY`, `https_proxy`, `HTTP_PROXY`, `http_proxy`. The timeout is 30 s. The progress bar is off when `CI` is set. `npm_config_platform` and `npm_config_arch` override the detected platform and arch.
- The README says the npm packages "include statically linked binaries." install.js downloads from GitHub Releases. Which applies to 5.3.0 is not settled.

### Locate
- `require('ffmpeg-static')` returns a path string or `null`.
- If the env var named by package.json's `binary-path-env-var` is set, the module returns its value without checking that the file exists.
- Otherwise it returns `path.join(__dirname, executableBaseName + ('.exe' on win32))`, or `null` when the platform and arch are unsupported. Supported: darwin x64 and arm64; freebsd x64; linux x64, ia32, arm64, and arm; win32 x64 and ia32.

### License and binaries
- Repo license: GPL-3.0 (GitHub sidebar). install.js saves each download's LICENSE file beside the binary.
- README sources: gyan.dev (Windows x64), sudo-nautilus (Windows x86), johnvansickle (Linux), evermeet.cx (macOS x64), and osxexperts.net (macOS arm64).
- README: "The ffmpeg version currently used is 6.1.1."

### Packaged apps
- The docs do not cover this. Inference: the path comes from `__dirname`, so in a packaged Electron build the binary sits under app.asar unless it is unpacked. better-sqlite3's troubleshooting gives the same advice for its native module. Verify with your bundler's unpack settings, or use the env override.

**Not settled by docs:** the env var names and pinned release tag, since package.json was not read. The mismatch between 5.3.0 and the master README's 6.1.1. Packaged app behavior.

**Settled by running it (Phase 2):**
- It's ffmpeg 6.1.1 (gyan.dev essentials), and `ffmpeg.exe` is the only binary. **There's no ffprobe.** `ffmpeg -i file` with no output prints the same description to stderr and exits with 1.
- One run can make two outputs: a thumbnail to a file and a raw decode to stdout. `-f mjpeg` lets the output be a temp name, `scale='min(512,iw)':-2` never upscales (the quotes are for ffmpeg's filter parser, not a shell), and a stream copy keeps attached pictures.
- It writes a fresh Xing frame on every MP3 remux, so a `-c copy` retag changes the first frame. Use `-write_xing 0` to compare frames.
