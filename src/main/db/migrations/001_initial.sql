-- Paths are relative to the music folder, with forward slashes.
-- Times are milliseconds since the epoch.

CREATE TABLE library_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;

-- Hash-keyed. Remembers where each image came from, so the art cache, which
-- doesn't travel with the music folder, can rebuild on any machine.
CREATE TABLE art (
  hash            TEXT PRIMARY KEY,
  source_kind     TEXT NOT NULL CHECK (source_kind IN ('embedded', 'folder')),
  source_rel_path TEXT NOT NULL,
  mime            TEXT NOT NULL,
  color           TEXT                -- average color as #rrggbb, for the accent
) WITHOUT ROWID;

-- One row per audio file on disk.
CREATE TABLE files (
  id            INTEGER PRIMARY KEY,
  rel_path      TEXT NOT NULL UNIQUE,
  size_bytes    INTEGER NOT NULL,
  mtime_ms      INTEGER NOT NULL,     -- unchanged size + mtime means skip re-reading tags
  audio_hash    TEXT,                 -- hash of the audio only, not the tags; survives retagging and moves
  codec         TEXT NOT NULL,
  is_lossless   INTEGER NOT NULL DEFAULT 0,
  sample_rate   INTEGER,
  bit_depth     INTEGER,
  channels      INTEGER,
  duration_ms   INTEGER NOT NULL,
  art_hash      TEXT REFERENCES art (hash) ON DELETE SET NULL,
  missing_since INTEGER,              -- NULL means present
  scanned_at    INTEGER NOT NULL
);
CREATE INDEX files_audio_hash ON files (audio_hash) WHERE audio_hash IS NOT NULL;
CREATE INDEX files_missing ON files (missing_since) WHERE missing_since IS NOT NULL;

CREATE TABLE artists (
  id        INTEGER PRIMARY KEY,
  name      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  sort_name TEXT NOT NULL             -- lowercase, no diacritics, leading "the" moved to the end
);
CREATE INDEX artists_sort ON artists (sort_name);

CREATE TABLE albums (
  id         INTEGER PRIMARY KEY,
  artist_id  INTEGER NOT NULL REFERENCES artists (id),  -- album artist, else artist
  title      TEXT NOT NULL COLLATE NOCASE,
  sort_title TEXT NOT NULL,
  year       INTEGER,
  art_hash   TEXT REFERENCES art (hash) ON DELETE SET NULL,
  UNIQUE (artist_id, title)
);
CREATE INDEX albums_artist ON albums (artist_id, year, sort_title);
CREATE INDEX albums_sort ON albums (sort_title);

-- What gets browsed and played. A normal file is one track (cue_index 0).
-- A CUE album is one file with many tracks, each a time range.
CREATE TABLE tracks (
  id           INTEGER PRIMARY KEY,
  file_id      INTEGER NOT NULL REFERENCES files (id) ON DELETE CASCADE,
  cue_index    INTEGER NOT NULL DEFAULT 0,
  start_ms     INTEGER NOT NULL DEFAULT 0,
  end_ms       INTEGER,               -- NULL means end of file
  title        TEXT NOT NULL,
  sort_title   TEXT NOT NULL,
  artist_id    INTEGER NOT NULL REFERENCES artists (id),
  album_id     INTEGER REFERENCES albums (id),
  disc_number  INTEGER,
  track_number INTEGER,
  year         INTEGER,
  UNIQUE (file_id, cue_index)
);
CREATE INDEX tracks_album ON tracks (album_id, disc_number, track_number);
CREATE INDEX tracks_artist ON tracks (artist_id);
CREATE INDEX tracks_sort ON tracks (sort_title);

CREATE TABLE genres (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE track_genres (           -- a track can have several genres
  track_id INTEGER NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
  genre_id INTEGER NOT NULL REFERENCES genres (id),
  PRIMARY KEY (track_id, genre_id)
) WITHOUT ROWID;
CREATE INDEX track_genres_genre ON track_genres (genre_id);

CREATE TABLE playlists (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE playlist_items (         -- own id: the same track can appear twice
  id          INTEGER PRIMARY KEY,
  playlist_id INTEGER NOT NULL REFERENCES playlists (id) ON DELETE CASCADE,
  track_id    INTEGER NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
  position    INTEGER NOT NULL        -- rewritten in one transaction on reorder
);
CREATE INDEX playlist_items_order ON playlist_items (playlist_id, position);
CREATE INDEX playlist_items_track ON playlist_items (track_id);

CREATE TABLE lyrics (                 -- one-to-one with tracks, so no join table
  track_id   INTEGER PRIMARY KEY REFERENCES tracks (id) ON DELETE CASCADE,
  status     TEXT NOT NULL CHECK (status IN ('found', 'not_found', 'instrumental')),
  synced_lrc TEXT,
  plain_text TEXT,
  fetched_at INTEGER NOT NULL         -- not_found stops re-asking LRCLIB every play
);

CREATE TABLE waveforms (
  file_id      INTEGER PRIMARY KEY REFERENCES files (id) ON DELETE CASCADE,
  peaks        BLOB NOT NULL,         -- one byte per bucket across the whole file
  generated_at INTEGER NOT NULL
);

CREATE TABLE play_events (
  id          INTEGER PRIMARY KEY,
  track_id    INTEGER NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
  played_at   INTEGER NOT NULL,
  listened_ms INTEGER NOT NULL
);
CREATE INDEX play_events_track ON play_events (track_id);
CREATE INDEX play_events_time ON play_events (played_at);

CREATE TABLE scan_issues (
  id       INTEGER PRIMARY KEY,
  rel_path TEXT NOT NULL,
  kind     TEXT NOT NULL,
  message  TEXT NOT NULL
);

-- rowid is tracks.id. Kept in sync by the scanner.
CREATE VIRTUAL TABLE tracks_fts USING fts5 (
  title,
  artist,
  album,
  tokenize = "unicode61 remove_diacritics 2",
  prefix = '2 3'
);
