-- What each CUE sheet came to last time, so a sheet that hasn't changed isn't read again.
CREATE TABLE cue_sheets (
  rel_path      TEXT PRIMARY KEY,
  size_bytes    INTEGER NOT NULL,
  mtime_ms      INTEGER NOT NULL,
  file_id       INTEGER REFERENCES files (id) ON DELETE SET NULL,  -- the file it cuts up, if any
  issue_kind    TEXT,
  issue_message TEXT
) WITHOUT ROWID;
