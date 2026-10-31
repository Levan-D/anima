-- What outside services say listeners hear together. Everything is by name, never by track id, and everything returned is
-- kept whether it's owned or not: owned is worked out when reading, so an album added later slots in with no new fetching.
-- `*_key` is the normalized form that gets compared, and the plain name is what gets shown.

-- Who has been asked about what. A failed lookup leaves no row, so the next update tries it again.
CREATE TABLE listener_lookups (
  source     TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('artist', 'track')),
  artist_key TEXT NOT NULL,
  title_key  TEXT NOT NULL,             -- '' for an artist
  mbid       TEXT,                      -- saves the MusicBrainz search on a refresh
  found      INTEGER NOT NULL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (source, kind, artist_key, title_key)
) WITHOUT ROWID;

CREATE TABLE similar_artists (
  source_key  TEXT NOT NULL,
  source_name TEXT NOT NULL,
  target_key  TEXT NOT NULL,
  target_name TEXT NOT NULL,
  score       REAL NOT NULL,            -- 0 to 1, against the best in that answer
  source      TEXT NOT NULL,
  fetched_at  INTEGER NOT NULL,
  PRIMARY KEY (source_key, target_key, source)
) WITHOUT ROWID;
CREATE INDEX similar_artists_target ON similar_artists (target_key);

CREATE TABLE similar_tracks (
  source_artist_key TEXT NOT NULL,
  source_title_key  TEXT NOT NULL,
  source_artist     TEXT NOT NULL,
  source_title      TEXT NOT NULL,
  target_artist_key TEXT NOT NULL,
  target_title_key  TEXT NOT NULL,
  target_artist     TEXT NOT NULL,
  target_title      TEXT NOT NULL,
  score             REAL NOT NULL,
  source            TEXT NOT NULL,
  fetched_at        INTEGER NOT NULL,
  PRIMARY KEY (source_artist_key, source_title_key, target_artist_key, target_title_key, source)
) WITHOUT ROWID;
CREATE INDEX similar_tracks_target ON similar_tracks (target_artist_key, target_title_key);
