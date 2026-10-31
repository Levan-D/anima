-- Who put a row here. Anything but 'lookup' is the person's own pick: it goes ahead of every other source, and nothing
-- automatic replaces it.
ALTER TABLE lyrics ADD COLUMN origin TEXT NOT NULL DEFAULT 'lookup' CHECK (origin IN ('lookup', 'search', 'file'));
