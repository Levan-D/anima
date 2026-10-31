-- Genres used to take in the Vorbis STYLE tag. A file's mtime going stale is what gets it read again, and only its tags
-- change: the row keeps its id, since its audio hash is the same.
UPDATE files SET mtime_ms = 0 WHERE id IN (
  SELECT t.file_id
  FROM tracks t
  JOIN track_genres tg ON tg.track_id = t.id
  GROUP BY t.id
  HAVING COUNT(*) > 1
);
