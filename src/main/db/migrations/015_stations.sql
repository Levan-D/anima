-- Mood stations, each defined by example. The model is worked out from the examples and kept so a station starts at once;
-- model_of says what it was worked out from, and anything else means working it out again.
CREATE TABLE stations (
  id             INTEGER PRIMARY KEY,
  name           TEXT NOT NULL,
  instrumental   INTEGER NOT NULL CHECK (instrumental IN (0, 1)),
  calm           INTEGER NOT NULL CHECK (calm IN (0, 1)),
  little_singing INTEGER NOT NULL CHECK (little_singing IN (0, 1)),
  genre          TEXT,                -- a main genre it keeps to
  decade         INTEGER,             -- a decade it keeps to
  model          BLOB,                -- float64 weights on the stored vectors as they are, then the bias
  model_of       TEXT,
  grade          TEXT,                -- JSON, true of the examples model_of names
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

-- By name keys, as theme_marks are, so an example outlasts a rescan. Position is the order they were given in, which
-- settles a song that two examples name.
CREATE TABLE station_examples (
  station_id INTEGER NOT NULL REFERENCES stations (id) ON DELETE CASCADE,
  position   INTEGER NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('track', 'album', 'artist', 'genre')),
  key        TEXT NOT NULL,
  label      TEXT NOT NULL,           -- what it was called when given, for when it's no longer in the library
  is_yes     INTEGER NOT NULL CHECK (is_yes IN (0, 1)),
  source     TEXT NOT NULL CHECK (source IN ('picked', 'check', 'listening')),
  PRIMARY KEY (station_id, kind, key)
) WITHOUT ROWID;
