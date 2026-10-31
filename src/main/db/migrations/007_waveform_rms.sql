-- Waveforms now have an RMS body as well as peaks, from a full-rate decode. Old rows have neither, and a track without a
-- row just gets its waveform worked out when it's played.
DROP TABLE waveforms;

CREATE TABLE waveforms (
  file_id      INTEGER PRIMARY KEY REFERENCES files (id) ON DELETE CASCADE,
  peaks        BLOB NOT NULL,         -- one byte per bucket across the whole file
  rms          BLOB NOT NULL,         -- the same buckets
  generated_at INTEGER NOT NULL
);
