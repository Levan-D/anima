-- What a person said about a song, album or artist's seasonal theme. Detection is worked out from the data as it stands, so
-- only this needs keeping. By name keys rather than ids: those survive a rescan, a rebuild and a file coming back.
CREATE TABLE theme_marks (
  kind  TEXT NOT NULL CHECK (kind IN ('track', 'album', 'artist')),
  key   TEXT NOT NULL,
  theme TEXT NOT NULL,  -- a theme's id, or 'none'
  PRIMARY KEY (kind, key)
) WITHOUT ROWID;
