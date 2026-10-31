-- What a track sounds like, as numbers from a model. Keyed by the audio, so retags, moves and rescans leave it alone, and a
-- row whose `model` isn't the current one counts as missing. `end_ms` is -1 for "to the end of the file", which a primary
-- key can't say with NULL. Nothing removes a row when its file goes: the file can come back.
CREATE TABLE fingerprints (
  audio_hash TEXT NOT NULL,
  start_ms   INTEGER NOT NULL,
  end_ms     INTEGER NOT NULL,
  model      TEXT NOT NULL,
  vector     BLOB NOT NULL,             -- float32, little-endian, unit length
  created_at INTEGER NOT NULL,
  PRIMARY KEY (audio_hash, start_ms, end_ms)
) WITHOUT ROWID;
