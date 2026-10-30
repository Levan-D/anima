-- Removing an art row sets these to NULL, and looks them up to do it.
CREATE INDEX files_art ON files (art_hash) WHERE art_hash IS NOT NULL;
CREATE INDEX albums_art ON albums (art_hash) WHERE art_hash IS NOT NULL;
