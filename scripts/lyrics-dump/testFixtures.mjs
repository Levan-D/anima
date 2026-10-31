/* Builds databases shaped like LRCLIB's dump, and a library.db to match them against. Everything in them is fake. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import Database from 'better-sqlite3';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const TEST_DATE = '2024-05-01T10:00:00.000Z';

// Verbatim from the real dump's sqlite_schema, except that lyrics starts out as it was before its ALTER TABLEs.
const SCHEMA = `
  CREATE TABLE tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    name_lower TEXT,
    artist_name TEXT,
    artist_name_lower TEXT,
    album_name TEXT,
    album_name_lower TEXT,
    duration FLOAT,
    last_lyrics_id INTEGER,
    created_at DATETIME,
    updated_at DATETIME,
    FOREIGN KEY (last_lyrics_id) REFERENCES lyrics (id),
    UNIQUE(name_lower, artist_name_lower, album_name_lower, duration)
  );
  CREATE TABLE lyrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plain_lyrics TEXT,
    synced_lyrics TEXT,
    track_id INTEGER,
    has_plain_lyrics BOOLEAN,
    has_synced_lyrics BOOLEAN,
    instrumental BOOLEAN,
    source TEXT,
    created_at DATETIME,
    updated_at DATETIME,
    FOREIGN KEY (track_id) REFERENCES tracks (id)
  );
  CREATE VIRTUAL TABLE tracks_fts USING fts5(
    name_lower,
    album_name_lower,
    artist_name_lower,
    content='tracks',
    content_rowid='id'
  );
  CREATE TABLE _litestream_seq (id INTEGER PRIMARY KEY, seq INTEGER);
  CREATE TABLE _litestream_lock (id INTEGER);
  CREATE TABLE flags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lyrics_id INTEGER,
    content TEXT,
    created_at DATETIME,
    FOREIGN KEY (lyrics_id) REFERENCES lyrics (id)
  );
  CREATE TABLE missing_tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    name_lower TEXT,
    artist_name TEXT,
    artist_name_lower TEXT,
    album_name TEXT,
    album_name_lower TEXT,
    duration FLOAT,
    created_at DATETIME,
    updated_at DATETIME,
    UNIQUE(name_lower, artist_name_lower, album_name_lower, duration)
  );
  CREATE INDEX idx_tracks_name_lower ON tracks (name_lower);
  CREATE INDEX idx_tracks_artist_name_lower ON tracks (artist_name_lower);
  CREATE INDEX idx_tracks_album_name_lower ON tracks (album_name_lower);
  CREATE INDEX idx_tracks_duration ON tracks (duration);
  CREATE INDEX idx_tracks_last_lyrics_id ON tracks (last_lyrics_id);
  CREATE INDEX idx_lyrics_track_id ON lyrics (track_id);
  CREATE INDEX idx_lyrics_has_plain_lyrics ON lyrics (has_plain_lyrics);
  CREATE INDEX idx_lyrics_has_synced_lyrics ON lyrics (has_synced_lyrics);
  CREATE INDEX idx_lyrics_source ON lyrics (source);
  CREATE INDEX idx_lyrics_created_at ON lyrics (created_at);
  CREATE INDEX idx_missing_tracks_name_lower ON missing_tracks (name_lower);
  CREATE INDEX idx_missing_tracks_artist_name_lower ON missing_tracks (artist_name_lower);
  CREATE INDEX idx_missing_tracks_album_name_lower ON missing_tracks (album_name_lower);
  CREATE INDEX idx_missing_tracks_duration ON missing_tracks (duration);
  CREATE INDEX idx_missing_tracks_created_at ON missing_tracks (created_at);
  CREATE INDEX idx_tracks_metadata_no_album ON tracks (name_lower, artist_name_lower, duration);
  CREATE TRIGGER set_tracks_last_lyrics_id
  AFTER INSERT ON lyrics
  BEGIN
    UPDATE tracks SET last_lyrics_id = NEW.id WHERE tracks.id = NEW.track_id;
  END;
  CREATE TRIGGER tracks_ai AFTER INSERT ON tracks
  BEGIN
    INSERT INTO tracks_fts (rowid, name_lower, album_name_lower, artist_name_lower)
    VALUES (new.id, new.name_lower, new.album_name_lower, new.artist_name_lower);
  END;
  CREATE TRIGGER tracks_au AFTER UPDATE ON tracks
  BEGIN
    INSERT INTO tracks_fts(tracks_fts, rowid, name_lower, album_name_lower, artist_name_lower)
    VALUES('delete', old.id, old.name_lower, old.album_name_lower, old.artist_name_lower);
    INSERT INTO tracks_fts (rowid, name_lower, album_name_lower, artist_name_lower)
    VALUES (new.id, new.name_lower, new.album_name_lower, new.artist_name_lower);
  END;
  CREATE TRIGGER tracks_ad AFTER DELETE ON tracks
  BEGIN
    INSERT INTO tracks_fts(tracks_fts, rowid, name_lower, album_name_lower, artist_name_lower)
    VALUES('delete', old.id, old.name_lower, old.album_name_lower, old.artist_name_lower);
  END;
`;

const LYRICS_COLUMN_MIGRATIONS = [
  'ALTER TABLE lyrics ADD COLUMN lyricsfile TEXT',
  `ALTER TABLE lyrics ADD COLUMN has_lyricsfile BOOLEAN NOT NULL DEFAULT FALSE;
   CREATE INDEX idx_lyrics_has_lyricsfile ON lyrics (has_lyricsfile)`,
  `ALTER TABLE lyrics ADD COLUMN has_word_sync BOOLEAN NOT NULL DEFAULT FALSE;
   CREATE INDEX idx_lyrics_has_word_sync ON lyrics (has_word_sync) WHERE has_word_sync = TRUE`,
];

const BASE_LYRICS_COLUMNS = [
  'id',
  'plain_lyrics',
  'synced_lyrics',
  'track_id',
  'has_plain_lyrics',
  'has_synced_lyrics',
  'instrumental',
  'source',
  'created_at',
  'updated_at',
];
const ADDED_LYRICS_COLUMNS = ['lyricsfile', 'has_lyricsfile', 'has_word_sync'];

export function makeTempDir() {
  const parent = join(root, '.dev/test-tmp');
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(join(parent, 'lyrics-dump-'));
}

export function removeTempDir(path) {
  rmSync(path, { recursive: true, force: true });
}

export function gzipFile(from, to) {
  writeFileSync(to, gzipSync(readFileSync(from), { level: 1 }));
}

export function seededRandom(seed) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 2 ** 32;
  };
}

function varintSize(value) {
  let size = 1;
  for (let rest = value; rest >= 128; rest = Math.floor(rest / 128)) size += 1;
  return size;
}

function serialOf(value) {
  if (value === null) return { type: 0, size: 0 };
  if (typeof value === 'string') {
    const size = Buffer.byteLength(value);
    return { type: 13 + 2 * size, size };
  }
  if (value === 0) return { type: 8, size: 0 };
  if (value === 1) return { type: 9, size: 0 };
  if (value <= 127) return { type: 1, size: 1 };
  if (value <= 32767) return { type: 2, size: 2 };
  if (value <= 8388607) return { type: 3, size: 3 };
  return { type: 4, size: 4 };
}

function recordSize(values) {
  const serials = values.map(serialOf);
  const header = serials.reduce((sum, { type }) => sum + varintSize(type), 0);
  return 1 + header + serials.reduce((sum, { size }) => sum + size, 0);
}

/**
 * The payload sizes around which spilling changes on a page this size, from fileformat2's formulas: where a payload stops
 * fitting (X), and where the part kept on the leaf wraps around, once for each overflow page (M + n * (U - 4)).
 */
export function spillBoundaries(pageSize) {
  const maxLocal = pageSize - 35;
  const minLocal = Math.floor(((pageSize - 12) * 32) / 255) - 23;
  const perPage = pageSize - 4;
  return [
    minLocal - 1,
    minLocal,
    minLocal + 1,
    maxLocal - 1,
    maxLocal,
    maxLocal + 1,
    minLocal + perPage - 1,
    minLocal + perPage,
    minLocal + perPage + 1,
    maxLocal + perPage,
    maxLocal + perPage + 1,
    minLocal + 2 * perPage - 1,
    minLocal + 2 * perPage,
  ];
}

/** A database with the dump's schema, and the writes that keep its triggers and ALTER TABLE history honest. */
export function openDump(path, { pageSize = 4096, autoVacuum = false, wal = false } = {}) {
  const db = new Database(path);
  db.pragma('synchronous = OFF');
  db.pragma(`page_size = ${pageSize}`);
  if (autoVacuum) db.pragma('auto_vacuum = FULL');
  if (wal) db.pragma('journal_mode = WAL');
  // Planted rows break the foreign keys on purpose, and the real dump's own checks aren't what's being tested.
  db.pragma('foreign_keys = OFF');
  db.exec(SCHEMA);

  let addedColumns = 0;
  const insertTrack = db.prepare(
    `INSERT INTO tracks (id, name, name_lower, artist_name, artist_name_lower, album_name, album_name_lower, duration,
       created_at, updated_at)
     VALUES (@id, @name, lower(@name), @artist, lower(@artist), @album, lower(@album), @duration, @date, @date)`,
  );
  const insertMissingTrack = db.prepare(
    `INSERT INTO missing_tracks (id, name, name_lower, artist_name, artist_name_lower, album_name, album_name_lower,
       duration, created_at, updated_at)
     VALUES (@id, @name, lower(@name), @artist, lower(@artist), @album, lower(@album), @duration, @date, @date)`,
  );
  const insertFlag = db.prepare('INSERT INTO flags (lyrics_id, content, created_at) VALUES (NULL, ?, ?)');

  const lyricsColumns = () => [...BASE_LYRICS_COLUMNS, ...ADDED_LYRICS_COLUMNS.slice(0, addedColumns)];

  let insertLyrics = null;
  const prepareInsertLyrics = () => {
    const columns = lyricsColumns();
    insertLyrics = db.prepare(
      `INSERT INTO lyrics (${columns.join(', ')}) VALUES (${columns.map((column) => `@${column}`).join(', ')})`,
    );
  };
  prepareInsertLyrics();

  const lyricsRow = (trackId, fields) => {
    const { plain = null, synced = null } = fields;
    return {
      id: fields.id ?? null,
      plain_lyrics: plain,
      synced_lyrics: synced,
      track_id: trackId,
      has_plain_lyrics: fields.hasPlain ?? (plain === null ? 0 : 1),
      has_synced_lyrics: fields.hasSynced ?? (synced === null ? 0 : 1),
      instrumental: fields.instrumental ?? 0,
      source: fields.source === undefined ? 'lrclib' : fields.source,
      created_at: fields.createdAt === undefined ? TEST_DATE : fields.createdAt,
      updated_at: fields.updatedAt === undefined ? TEST_DATE : fields.updatedAt,
      lyricsfile: fields.lyricsfile ?? null,
      has_lyricsfile: fields.hasLyricsfile ?? 0,
      has_word_sync: fields.hasWordSync ?? 0,
    };
  };

  const addLyrics = (trackId, fields = {}) => {
    const row = lyricsRow(trackId, fields);
    const values = Object.fromEntries(lyricsColumns().map((column) => [column, row[column]]));
    return Number(insertLyrics.run(values).lastInsertRowid);
  };

  const addLyricsColumn = () => {
    db.exec(LYRICS_COLUMN_MIGRATIONS[addedColumns]);
    addedColumns += 1;
    prepareInsertLyrics();
  };

  return {
    db,
    addTrack: ({ id = null, name, artist, album = null, duration }) =>
      Number(insertTrack.run({ id, name, artist, album, duration, date: TEST_DATE }).lastInsertRowid),
    addMissingTrack: ({ id = null, name, artist, album = null, duration, date = TEST_DATE }) =>
      Number(insertMissingTrack.run({ id, name, artist, album, duration, date }).lastInsertRowid),
    addLyrics,
    addLyricsColumn,

    /** A plain_lyrics long enough for this row's whole record to be exactly `payloadSize` bytes, or null if none can be. */
    addLyricsOfPayload(trackId, payloadSize, fields = {}) {
      const row = lyricsRow(trackId, { ...fields, plain: null });
      const rest = recordSize(lyricsColumns().map((column) => (column === 'id' ? null : row[column]))) - 1;
      for (let bytes = Math.max(0, payloadSize - rest - 3); bytes <= payloadSize; bytes += 1) {
        if (bytes + varintSize(13 + 2 * bytes) + rest === payloadSize) {
          return addLyrics(trackId, { ...fields, plain: 'x'.repeat(bytes) });
        }
      }
      return null;
    },

    /** The extract refuses free pages, so a test either VACUUMs them away or fills them, as a busy database would. */
    finish({ vacuum = false } = {}) {
      while (addedColumns < LYRICS_COLUMN_MIGRATIONS.length) addLyricsColumn();
      db.exec('ANALYZE');
      // The real dump's empty partial index leaves a row like this, which doesn't count the table's rows.
      db.exec("INSERT INTO sqlite_stat1 VALUES ('lyrics', 'idx_lyrics_has_word_sync', '0 0')");
      if (vacuum) db.exec('VACUUM');
      while (db.pragma('freelist_count', { simple: true }) > 0) insertFlag.run('free '.repeat(800), TEST_DATE);
      db.close();
    },
  };
}

export function writeLibrary(path, tracks) {
  const db = new Database(path);
  db.exec(`
    CREATE TABLE artists (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE albums (id INTEGER PRIMARY KEY, title TEXT NOT NULL);
    CREATE TABLE files (
      id INTEGER PRIMARY KEY,
      rel_path TEXT NOT NULL,
      audio_hash TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      missing_since INTEGER
    );
    CREATE TABLE tracks (
      id INTEGER PRIMARY KEY,
      file_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      artist_id INTEGER NOT NULL,
      album_id INTEGER
    );
  `);
  const addArtist = db.prepare('INSERT INTO artists (name) VALUES (?)');
  const addAlbum = db.prepare('INSERT INTO albums (title) VALUES (?)');
  const addFile = db.prepare('INSERT INTO files (rel_path, audio_hash, duration_ms) VALUES (?, ?, ?)');
  const addTrack = db.prepare('INSERT INTO tracks (file_id, title, artist_id, album_id) VALUES (?, ?, ?, ?)');
  tracks.forEach(({ title, artist, album, durationMs }, index) => {
    const number = String(index).padStart(4, '0');
    const fileId = addFile.run(`Music/${number}.flac`, `hash-${number}`, durationMs).lastInsertRowid;
    const artistId = addArtist.run(artist).lastInsertRowid;
    const albumId = album === null ? null : addAlbum.run(album).lastInsertRowid;
    addTrack.run(fileId, title, artistId, albumId);
  });
  db.close();
}
