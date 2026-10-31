-- Pressing Next early on a track: a signal for recommendations, which play_events can't give because it only has plays.
CREATE TABLE track_skips (
  track_id     INTEGER PRIMARY KEY REFERENCES tracks (id) ON DELETE CASCADE,
  skips        INTEGER NOT NULL,
  last_skip_at INTEGER NOT NULL
);
