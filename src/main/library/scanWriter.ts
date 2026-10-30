/* Every write a scan makes. Transactions stay small, so main is never left waiting on the lock. */

import type { ScanIssue } from '@shared/domain';
import type { Connection } from '@main/db/connection';
import { createLibraryMeta } from '@main/library/libraryMeta';
import { createOrphanPruner } from '@main/library/orphans';
import type { FoundFile, KnownFile, MatchedFile, Move } from '@main/library/reconcile';
import { displacedPath } from '@main/library/relPath';
import { searchText, sortKey } from '@main/library/sortKey';
import type { FileFormat, FileTags } from '@main/library/tags';

// Present tracks only: a missing file shouldn't decide what an album looks like while the rest are here.
const ALBUM_AGGREGATES = `
  year = (
    SELECT MIN(t.year) FROM tracks t JOIN files f ON f.id = t.file_id
    WHERE t.album_id = albums.id AND f.missing_since IS NULL
  ),
  art_hash = (
    SELECT f.art_hash FROM tracks t JOIN files f ON f.id = t.file_id
    WHERE t.album_id = albums.id AND f.missing_since IS NULL AND f.art_hash IS NOT NULL
    ORDER BY COALESCE(t.disc_number, 1), COALESCE(t.track_number, 1000000), t.sort_title
    LIMIT 1
  )`;

export type ArtRef = {
  hash: string;
  kind: 'embedded' | 'folder';
  relPath: string;
  mime: string;
};

export type ReadFile = {
  id: number | null;
  found: FoundFile;
  audioHash: string | null;
  tags: FileTags;
  format: FileFormat;
  art: ArtRef | null;
  /** The folder image couldn't be read this time, so the file's art stays what it was. */
  keepArt: boolean;
};

export type FileHash = {
  id: number;
  hash: string;
};

export type FolderArtChange = {
  fileId: number;
  art: ArtRef | null;
};

type FileWithFolderArt = {
  id: number;
  relPath: string;
  artHash: string | null;
};

type FinishInput = {
  missing: KnownFile[];
  folderArt: FolderArtChange[];
  /** Folder images that are still in use, so the art rows can say where they are now. */
  artSources: ArtRef[];
  issues: ScanIssue[];
  somethingChanged: boolean;
};

type FileParams = {
  relPath: string;
  sizeBytes: number;
  mtimeMs: number;
  audioHash: string | null;
  codec: string;
  isLossless: number;
  sampleRate: number | null;
  bitDepth: number | null;
  channels: number | null;
  durationMs: number;
  artHash: string | null;
  artSource: 'embedded' | 'folder' | null;
  scannedAt: number;
};

type TrackParams = {
  fileId: number;
  title: string;
  sortTitle: string;
  artistId: number;
  albumId: number | null;
  discNumber: number | null;
  trackNumber: number | null;
  year: number | null;
};

export function createScanWriter(db: Connection, { now, hostname }: { now: () => number; hostname: string }) {
  const statements = {
    knownFiles: db.prepare<[], KnownFile>(
      `SELECT id, rel_path AS relPath, size_bytes AS sizeBytes, mtime_ms AS mtimeMs,
              audio_hash AS audioHash, missing_since AS missingSince
       FROM files`,
    ),
    filesWithFolderArt: db.prepare<[], FileWithFolderArt>(
      `SELECT id, rel_path AS relPath, art_hash AS artHash
       FROM files
       WHERE missing_since IS NULL AND (art_hash IS NULL OR art_source = 'folder')`,
    ),
    filesWithoutHash: db.prepare<[], { id: number; relPath: string }>(
      `SELECT id, rel_path AS relPath FROM files
       WHERE audio_hash IS NULL AND missing_since IS NULL ORDER BY rel_path`,
    ),
    setHash: db.prepare<[string, number]>('UPDATE files SET audio_hash = ? WHERE id = ?'),
    badTagIssues: db.prepare<[], ScanIssue>(
      `SELECT rel_path AS relPath, kind, message FROM scan_issues WHERE kind = 'bad_tags'`,
    ),

    selectArtist: db.prepare<[string], { id: number }>('SELECT id FROM artists WHERE name = ?'),
    insertArtist: db.prepare<[string, string]>('INSERT INTO artists (name, sort_name) VALUES (?, ?)'),
    selectAlbum: db.prepare<[number, string], { id: number }>(
      'SELECT id FROM albums WHERE artist_id = ? AND title = ?',
    ),
    insertAlbum: db.prepare<[number, string, string]>(
      'INSERT INTO albums (artist_id, title, sort_title) VALUES (?, ?, ?)',
    ),
    selectGenre: db.prepare<[string], { id: number }>('SELECT id FROM genres WHERE name = ?'),
    insertGenre: db.prepare<[string]>('INSERT INTO genres (name) VALUES (?)'),
    // A folder image can be read from another folder than last time. An embedded one follows its file through the renames.
    upsertArt: db.prepare<[ArtRef]>(
      `INSERT INTO art (hash, source_kind, source_rel_path, mime) VALUES (@hash, @kind, @relPath, @mime)
       ON CONFLICT (hash) DO UPDATE SET source_kind = excluded.source_kind, source_rel_path = excluded.source_rel_path
       WHERE excluded.source_kind = 'folder'`,
    ),
    setArtSource: db.prepare<[ArtRef]>(
      `UPDATE art SET source_kind = @kind, source_rel_path = @relPath
       WHERE hash = @hash AND (source_kind <> @kind OR source_rel_path <> @relPath)`,
    ),

    insertFile: db.prepare<[FileParams]>(
      `INSERT INTO files (rel_path, size_bytes, mtime_ms, audio_hash, codec, is_lossless, sample_rate, bit_depth,
                          channels, duration_ms, art_hash, art_source, scanned_at)
       VALUES (@relPath, @sizeBytes, @mtimeMs, @audioHash, @codec, @isLossless, @sampleRate, @bitDepth,
               @channels, @durationMs, @artHash, @artSource, @scannedAt)`,
    ),
    updateFile: db.prepare<[FileParams & { id: number }]>(
      `UPDATE files SET rel_path = @relPath, size_bytes = @sizeBytes, mtime_ms = @mtimeMs, audio_hash = @audioHash,
         codec = @codec, is_lossless = @isLossless, sample_rate = @sampleRate, bit_depth = @bitDepth,
         channels = @channels, duration_ms = @durationMs, art_hash = @artHash, art_source = @artSource,
         missing_since = NULL, scanned_at = @scannedAt
       WHERE id = @id`,
    ),
    fileArt: db.prepare<[number], { artHash: string | null; artSource: FileParams['artSource'] }>(
      'SELECT art_hash AS artHash, art_source AS artSource FROM files WHERE id = ?',
    ),
    selectTrack: db.prepare<[number], { id: number; albumId: number | null }>(
      'SELECT id, album_id AS albumId FROM tracks WHERE file_id = ? AND cue_index = 0',
    ),
    insertTrack: db.prepare<[TrackParams]>(
      `INSERT INTO tracks (file_id, title, sort_title, artist_id, album_id, disc_number, track_number, year)
       VALUES (@fileId, @title, @sortTitle, @artistId, @albumId, @discNumber, @trackNumber, @year)`,
    ),
    updateTrack: db.prepare<[TrackParams & { id: number }]>(
      `UPDATE tracks SET title = @title, sort_title = @sortTitle, artist_id = @artistId, album_id = @albumId,
         disc_number = @discNumber, track_number = @trackNumber, year = @year
       WHERE id = @id`,
    ),
    deleteTrackGenres: db.prepare<[number]>('DELETE FROM track_genres WHERE track_id = ?'),
    insertTrackGenre: db.prepare<[number, number]>(
      'INSERT OR IGNORE INTO track_genres (track_id, genre_id) VALUES (?, ?)',
    ),
    deleteFts: db.prepare<[number]>('DELETE FROM tracks_fts WHERE rowid = ?'),
    insertFts: db.prepare<[number, string, string, string]>(
      'INSERT INTO tracks_fts (rowid, title, artist, album) VALUES (?, ?, ?, ?)',
    ),

    restoreFile: db.prepare<[number]>('UPDATE files SET missing_since = NULL WHERE id = ?'),
    renameFile: db.prepare<[string, number]>('UPDATE files SET rel_path = ? WHERE id = ?'),
    renameArtSource: db.prepare<[string, string]>('UPDATE art SET source_rel_path = ? WHERE source_rel_path = ?'),
    markMissing: db.prepare<[number, number]>(
      'UPDATE files SET missing_since = ? WHERE id = ? AND missing_since IS NULL',
    ),
    setFileArt: db.prepare<[string | null, FileParams['artSource'], number]>(
      'UPDATE files SET art_hash = ?, art_source = ? WHERE id = ?',
    ),

    refreshAlbum: db.prepare<[number]>(`UPDATE albums SET ${ALBUM_AGGREGATES} WHERE id = ?`),
    refreshAllAlbums: db.prepare<[]>(`UPDATE albums SET ${ALBUM_AGGREGATES}`),

    clearIssues: db.prepare<[]>('DELETE FROM scan_issues'),
    insertIssue: db.prepare<[string, string, string]>(
      'INSERT INTO scan_issues (rel_path, kind, message) VALUES (?, ?, ?)',
    ),
  };

  function artistId(name: string): number {
    const existing = statements.selectArtist.get(name);
    if (existing) return existing.id;
    return Number(statements.insertArtist.run(name, sortKey(name)).lastInsertRowid);
  }

  function albumId(tags: FileTags): number | null {
    if (tags.album === null) return null;
    const owner = artistId(tags.albumArtist);
    const existing = statements.selectAlbum.get(owner, tags.album);
    if (existing) return existing.id;
    return Number(statements.insertAlbum.run(owner, tags.album, sortKey(tags.album)).lastInsertRowid);
  }

  function genreId(name: string): number {
    const existing = statements.selectGenre.get(name);
    if (existing) return existing.id;
    return Number(statements.insertGenre.run(name).lastInsertRowid);
  }

  const meta = createLibraryMeta(db);
  const pruneOrphans = createOrphanPruner(db);
  const markChanged = () => meta.markChanged(now(), hostname);

  function saveFile(file: ReadFile, scannedAt: number): number {
    const { found, audioHash, format, art, keepArt, id } = file;
    if (art) statements.upsertArt.run(art);
    const kept = keepArt && id !== null ? statements.fileArt.get(id) : undefined;

    const params: FileParams = {
      relPath: found.relPath,
      sizeBytes: found.sizeBytes,
      mtimeMs: found.mtimeMs,
      audioHash,
      codec: format.codec,
      isLossless: Number(format.isLossless),
      sampleRate: format.sampleRate,
      bitDepth: format.bitDepth,
      channels: format.channels,
      durationMs: format.durationMs,
      artHash: kept ? kept.artHash : (art?.hash ?? null),
      artSource: kept ? kept.artSource : (art?.kind ?? null),
      scannedAt,
    };
    if (id === null) return Number(statements.insertFile.run(params).lastInsertRowid);
    statements.updateFile.run({ ...params, id });
    return id;
  }

  function saveTrack(fileId: number, tags: FileTags, touched: Set<number>): void {
    const { title, artist, album, discNumber, trackNumber, year, genres } = tags;
    const newAlbumId = albumId(tags);
    if (newAlbumId !== null) touched.add(newAlbumId);

    const params: TrackParams = {
      fileId,
      title,
      sortTitle: sortKey(title),
      artistId: artistId(artist),
      albumId: newAlbumId,
      discNumber,
      trackNumber,
      year,
    };

    const existing = statements.selectTrack.get(fileId);
    let trackId: number;
    if (existing) {
      trackId = existing.id;
      if (existing.albumId !== null) touched.add(existing.albumId);
      statements.updateTrack.run({ ...params, id: trackId });
      statements.deleteTrackGenres.run(trackId);
      statements.deleteFts.run(trackId);
    } else {
      trackId = Number(statements.insertTrack.run(params).lastInsertRowid);
    }

    for (const genre of genres) statements.insertTrackGenre.run(trackId, genreId(genre));
    statements.insertFts.run(trackId, searchText(title), searchText(artist), searchText(album ?? ''));
  }

  const commit = db.transaction((files: ReadFile[]) => {
    const scannedAt = now();
    const touched = new Set<number>();
    for (const file of files) saveTrack(saveFile(file, scannedAt), file.tags, touched);
    for (const id of touched) statements.refreshAlbum.run(id);
    markChanged();
  });

  const saveHashes = db.transaction((hashes: FileHash[]) => {
    for (const { id, hash } of hashes) statements.setHash.run(hash, id);
  });

  const applyIdentity = db.transaction(
    (restored: MatchedFile[], renamed: MatchedFile[], moves: Move[], displaced: KnownFile[]) => {
      for (const { known } of restored) statements.restoreFile.run(known.id);
      for (const { known, found } of renamed) {
        statements.renameFile.run(found.relPath, known.id);
        statements.renameArtSource.run(found.relPath, known.relPath);
      }

      // In two steps, because in a swap each row wants the path the other one still holds.
      for (const known of [...moves.map((move) => move.known), ...displaced]) {
        const parked = displacedPath(known.id, known.relPath);
        statements.renameFile.run(parked, known.id);
        statements.renameArtSource.run(parked, known.relPath);
      }
      for (const { known, found } of moves) {
        const parked = displacedPath(known.id, known.relPath);
        statements.renameFile.run(found.relPath, known.id);
        statements.restoreFile.run(known.id);
        statements.renameArtSource.run(found.relPath, parked);
      }
      markChanged();
    },
  );

  const finish = db.transaction(({ missing, folderArt, artSources, issues, somethingChanged }: FinishInput) => {
    const time = now();
    for (const { id } of missing) statements.markMissing.run(time, id);
    for (const { fileId, art } of folderArt) {
      if (art) statements.upsertArt.run(art);
      statements.setFileArt.run(art?.hash ?? null, art?.kind ?? null, fileId);
    }
    for (const art of artSources) statements.setArtSource.run(art);

    // Every time: a scan that stopped early can leave restored files that nothing here would count as a change.
    statements.refreshAllAlbums.run();
    pruneOrphans();
    if (somethingChanged) markChanged();

    statements.clearIssues.run();
    for (const { relPath, kind, message } of issues) statements.insertIssue.run(relPath, kind, message);
    meta.setLastScanAt(time);
  });

  return {
    knownFiles: () => statements.knownFiles.all(),
    filesWithFolderArt: () => statements.filesWithFolderArt.all(),
    filesWithoutHash: () => statements.filesWithoutHash.all(),
    saveHashes: (hashes: FileHash[]) => {
      if (hashes.length > 0) saveHashes.immediate(hashes);
    },
    badTagIssues: () => statements.badTagIssues.all(),
    commit: (files: ReadFile[]) => commit.immediate(files),
    applyIdentity: (restored: MatchedFile[], renamed: MatchedFile[], moves: Move[], displaced: KnownFile[]) => {
      if (restored.length + renamed.length + moves.length + displaced.length > 0) {
        applyIdentity.immediate(restored, renamed, moves, displaced);
      }
    },
    finish: (input: FinishInput) => finish.immediate(input),
  };
}
