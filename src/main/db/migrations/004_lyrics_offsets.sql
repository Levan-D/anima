-- The hand nudge. Apart from lyrics, because it applies to every source, and .lrc and embedded lyrics have no row there.
CREATE TABLE lyrics_offsets (
  track_id  INTEGER PRIMARY KEY REFERENCES tracks (id) ON DELETE CASCADE,
  offset_ms INTEGER NOT NULL
);
