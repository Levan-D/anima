-- An MP3's ID3v2 genre now beats its APEv2 one, so those get read again. See 006 for why this is how.
UPDATE files SET mtime_ms = 0 WHERE rel_path LIKE '%.mp3';
