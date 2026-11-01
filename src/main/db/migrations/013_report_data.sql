-- What the Library report asks of a file or an image and nothing else needed before. NULL means it hasn't been read yet,
-- which isn't a no: the report reads each file's header once to fill these, so no mtime is cleared and no rescan is needed.
-- A width of 0 is an image that couldn't be measured.
ALTER TABLE art ADD COLUMN width INTEGER;
ALTER TABLE art ADD COLUMN height INTEGER;

ALTER TABLE files ADD COLUMN has_replaygain INTEGER;
ALTER TABLE files ADD COLUMN has_album_artist INTEGER;
ALTER TABLE files ADD COLUMN has_gapless_header INTEGER;  -- MP3s only: a Xing or Info header
