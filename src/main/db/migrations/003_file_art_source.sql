-- Where this file got its art. The art row can't say: it's per image, and one image can be embedded
-- in one file and sit in another's folder. A scan rechecks folder art, and leaves embedded art to the file.
ALTER TABLE files ADD COLUMN art_source TEXT CHECK (art_source IN ('embedded', 'folder'));

UPDATE files
SET art_source = (SELECT source_kind FROM art WHERE art.hash = files.art_hash)
WHERE art_hash IS NOT NULL;
