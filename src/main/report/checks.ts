/*
 * What the Library report looks for, most worth fixing by hand first. It's a to-do for foobar2000, and only reads: adding
 * a check is one entry here. Each `sql` selects the `id` of what it found, in the order it should be listed.
 */
import type { LibraryReport, ReportGroup, ReportSummary } from '@shared/domain';
import type { Connection } from '@main/db/connection';
import { FINGERPRINT_MODEL } from '@main/fingerprints/model';
import { artistKey, titleKey } from '@main/library/names';
import { UNKNOWN_ARTIST } from '@main/library/tags';
import { LISTENBRAINZ } from '@main/listeners/services';

export const LOW_RES_COVER_PX = 500;
export const SMALL_COVER_PX = 1000;
export const LOW_BITRATE_KBPS = 192;
export const HI_RES_MIN_RATE_HZ = 48_000;
export const HI_RES_MIN_BITS = 16;

const PRESENT = 'f.missing_since IS NULL';
const FROM_TRACKS = `
  FROM tracks t
  JOIN files f ON f.id = t.file_id
  JOIN artists ar ON ar.id = t.artist_id
  LEFT JOIN albums al ON al.id = t.album_id
  LEFT JOIN artists aa ON aa.id = al.artist_id
  LEFT JOIN art ON art.hash = f.art_hash
  LEFT JOIN lyrics l ON l.track_id = t.id`;

const ALBUM_ORDER =
  'COALESCE(aa.sort_name, ar.sort_name), al.year, al.sort_title, COALESCE(t.disc_number, 1), COALESCE(t.track_number, 1000000), t.sort_title, t.id';
const BITRATE = 'f.size_bytes * 8.0 / NULLIF(f.duration_ms, 0)';
const COVER_SIDE = 'MIN(art.width, art.height)';

function presentTracks(where: string, orderBy = ALBUM_ORDER): string {
  return `SELECT t.id ${FROM_TRACKS} WHERE ${PRESENT} AND (${where}) ORDER BY ${orderBy}`;
}

/** What a check needs that a report has to go and read, so its count isn't an answer until that's done. */
type Needs = 'file-facts' | 'art-sizes' | null;

export type CheckDefinition = {
  id: string;
  name: string;
  description: string;
  sql: string;
  isInfo?: boolean;
  needs?: Needs;
  opensData?: boolean;
  shows?: 'tracks' | 'issues';
};

type GroupDefinition = {
  name: string;
  checks: CheckDefinition[];
};

export const REPORT_GROUPS: GroupDefinition[] = [
  {
    name: 'Files',
    checks: [
      {
        id: 'missing',
        name: 'Missing',
        description: 'In the library, but the file is no longer there',
        sql: `SELECT t.id ${FROM_TRACKS} WHERE f.missing_since IS NOT NULL ORDER BY f.rel_path, t.id`,
      },
      {
        id: 'duplicates',
        name: 'Duplicates',
        description: 'The same audio in more than one file, listed side by side',
        sql: presentTracks(
          `f.audio_hash IN (
             SELECT audio_hash FROM files WHERE audio_hash IS NOT NULL AND missing_since IS NULL
             GROUP BY audio_hash HAVING COUNT(*) > 1
           )`,
          'f.audio_hash, f.rel_path, t.id',
        ),
      },
      {
        id: 'scan-issues',
        name: 'Scan issues',
        description: "Files and CUE sheets the last scan couldn't use",
        sql: `SELECT id FROM scan_issues WHERE kind <> 'bad_tags' ORDER BY kind, rel_path`,
        shows: 'issues',
      },
    ],
  },
  {
    name: 'Tags',
    checks: [
      {
        id: 'repeated-track-numbers',
        name: 'Repeated track numbers',
        description: 'Two tracks in one album share a number and have no disc number, so they play out of order',
        sql: presentTracks(
          `t.disc_number IS NULL AND (t.album_id, t.track_number) IN (
             SELECT x.album_id, x.track_number FROM tracks x JOIN files xf ON xf.id = x.file_id
             WHERE xf.missing_since IS NULL AND x.album_id IS NOT NULL AND x.track_number IS NOT NULL
               AND x.disc_number IS NULL
             GROUP BY x.album_id, x.track_number HAVING COUNT(*) > 1
           )`,
        ),
      },
      {
        id: 'title-is-file-name',
        name: 'Title is the file name',
        description: 'No title tag, so the file name is shown instead',
        sql: presentTracks(
          `f.rel_path IN (SELECT rel_path FROM scan_issues WHERE kind = 'bad_tags')`,
          'f.rel_path, t.id',
        ),
      },
      {
        id: 'no-album',
        name: 'No album',
        description: "No album tag, so it isn't under any album",
        sql: presentTracks('t.album_id IS NULL', 'ar.sort_name, t.sort_title, t.id'),
      },
      {
        id: 'no-track-number',
        name: 'No track number',
        description: 'In an album with no track number, so it sorts after the numbered ones',
        sql: presentTracks('t.album_id IS NOT NULL AND t.track_number IS NULL'),
      },
      {
        id: 'no-year',
        name: 'No year',
        description: 'No date tag, so its album sorts ahead of the dated ones',
        sql: presentTracks('t.year IS NULL'),
      },
      {
        id: 'no-genre',
        name: 'No genre',
        description: "No genre tag, so it's under no genre and Radio knows less about it",
        sql: presentTracks('NOT EXISTS (SELECT 1 FROM track_genres tg WHERE tg.track_id = t.id)'),
      },
      {
        id: 'no-replaygain',
        name: 'No ReplayGain',
        description: 'No track gain tag, so ReplayGain leaves it as it is',
        sql: presentTracks('f.has_replaygain = 0'),
        needs: 'file-facts',
      },
      {
        id: 'no-album-artist',
        name: 'No album artist',
        description: 'Credited to the track artist instead, which only matters on a mixed album',
        sql: presentTracks('t.album_id IS NOT NULL AND f.has_album_artist = 0'),
        needs: 'file-facts',
      },
    ],
  },
  {
    name: 'Art',
    checks: [
      {
        id: 'no-cover',
        name: 'No cover',
        description: 'Nothing embedded and no image in its folder',
        sql: presentTracks('f.art_hash IS NULL'),
      },
      {
        id: 'cover-low-res',
        name: `Cover under ${LOW_RES_COVER_PX} px`,
        description: 'Soft even on a small screen, with the smallest first',
        sql: presentTracks(`art.width > 0 AND ${COVER_SIDE} < ${LOW_RES_COVER_PX}`, `${COVER_SIDE}, ${ALBUM_ORDER}`),
        needs: 'art-sizes',
      },
      {
        id: 'cover-small',
        name: `Cover under ${SMALL_COVER_PX} px`,
        description: 'Those above as well, and soft at full height on a big screen',
        sql: presentTracks(`art.width > 0 AND ${COVER_SIDE} < ${SMALL_COVER_PX}`, `${COVER_SIDE}, ${ALBUM_ORDER}`),
        needs: 'art-sizes',
      },
    ],
  },
  {
    name: 'Audio quality',
    checks: [
      {
        id: 'lossy-low-bitrate',
        name: `Lossy under ${LOW_BITRATE_KBPS} kbps`,
        description: 'Worth finding a better copy, going by file size over length, lowest first',
        sql: presentTracks(`f.is_lossless = 0 AND ${BITRATE} < ${LOW_BITRATE_KBPS}`, `${BITRATE}, ${ALBUM_ORDER}`),
      },
      {
        id: 'no-gapless-header',
        name: "MP3s that can't be gapless",
        description: "No Xing or Info header, so nothing says what's padding between tracks",
        sql: presentTracks('f.has_gapless_header = 0'),
        needs: 'file-facts',
      },
      {
        id: 'lossy',
        name: 'MP3s and other lossy',
        description: 'Not FLAC, lowest bitrate first',
        sql: presentTracks('f.is_lossless = 0', `${BITRATE}, ${ALBUM_ORDER}`),
      },
      {
        id: 'flac-md5-unset',
        name: 'FLACs with no MD5',
        description: "The encoder left it unset, so the audio can't be verified against it",
        sql: presentTracks(`f.codec = 'FLAC' AND f.audio_hash LIKE 'frames:%'`),
      },
      {
        id: 'hi-res',
        name: 'Hi-res',
        description: `Lossless above ${HI_RES_MIN_BITS}-bit or ${HI_RES_MIN_RATE_HZ / 1000} kHz, for information`,
        sql: presentTracks(
          `f.is_lossless = 1 AND (f.sample_rate > ${HI_RES_MIN_RATE_HZ} OR f.bit_depth > ${HI_RES_MIN_BITS})`,
          `f.sample_rate DESC, f.bit_depth DESC, ${ALBUM_ORDER}`,
        ),
        isInfo: true,
      },
    ],
  },
  {
    name: 'Lyrics',
    checks: [
      {
        id: 'no-lyrics',
        name: 'No lyrics',
        description: "Nothing stored. Lyrics in the file or an .lrc beside it aren't counted here",
        sql: presentTracks(`l.track_id IS NULL OR l.status = 'not_found'`),
        opensData: true,
      },
      {
        id: 'lyrics-not-asked',
        name: 'Lyrics not looked up',
        description: "LRCLIB hasn't been asked yet, or was down when it was",
        sql: presentTracks(`l.track_id IS NULL AND ar.name <> '${UNKNOWN_ARTIST}'`),
        opensData: true,
      },
      {
        id: 'lyrics-plain',
        name: 'Lyrics not timed',
        description: 'Plain text only, so nothing follows along',
        sql: presentTracks(`l.status = 'found' AND l.synced_lrc IS NULL`),
      },
      {
        id: 'lyrics-instrumental',
        name: 'Flagged instrumental',
        description: 'LRCLIB says there are no words, which is worth a look on anything with singing',
        sql: presentTracks(`l.status = 'instrumental'`),
      },
    ],
  },
  {
    name: 'Recommendation data',
    checks: [
      {
        id: 'no-fingerprint',
        name: 'No fingerprint',
        description: "Not analyzed yet, so Radio can't tell what it sounds like",
        sql: presentTracks(
          `f.audio_hash IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM fingerprints p
             WHERE p.audio_hash = f.audio_hash AND p.start_ms = t.start_ms AND p.end_ms = COALESCE(t.end_ms, -1)
               AND p.model = '${FINGERPRINT_MODEL}'
           )`,
        ),
        opensData: true,
      },
      {
        id: 'not-looked-up',
        name: 'Not in Discover data',
        description: "Its artist or the track hasn't been looked up",
        sql: presentTracks(
          `ar.name <> '${UNKNOWN_ARTIST}' AND (
             NOT EXISTS (
               SELECT 1 FROM listener_lookups u
               WHERE u.source = '${LISTENBRAINZ}' AND u.kind = 'artist' AND u.artist_key = artist_key(ar.name)
             ) OR NOT EXISTS (
               SELECT 1 FROM listener_lookups u
               WHERE u.source = '${LISTENBRAINZ}' AND u.kind = 'track' AND u.artist_key = artist_key(ar.name)
                 AND u.title_key = title_key(t.title)
             )
           )`,
        ),
        opensData: true,
      },
    ],
  },
];

const ALL_CHECKS = REPORT_GROUPS.flatMap(({ checks }) => checks);

export function checkById(id: string): CheckDefinition | null {
  return ALL_CHECKS.find((check) => check.id === id) ?? null;
}

/** How much a report still has to read, and how many each check found so far. */
export type StoredReport = {
  summary: ReportSummary;
  counts: Record<string, number>;
  unreadFiles: number;
  unmeasuredArt: number;
};

export type ReportQueries = ReturnType<typeof createReportQueries>;

export function createReportQueries(db: Connection) {
  // Stored keys come from these two, in JavaScript, so a track's own have to as well.
  db.function('artist_key', { deterministic: true }, (name) => artistKey(String(name)));
  db.function('title_key', { deterministic: true }, (title) => titleKey(String(title)));

  const counts = ALL_CHECKS.map(({ id, sql }) => ({
    id,
    statement: db.prepare<[], { count: number }>(`SELECT COUNT(*) AS count FROM (${sql})`),
  }));
  const summary = db.prepare<[], ReportSummary>(`
    SELECT
      COUNT(*) AS tracks,
      COUNT(DISTINCT t.album_id) AS albums,
      COUNT(DISTINCT t.artist_id) AS artists,
      COALESCE(SUM(COALESCE(t.end_ms, f.duration_ms) - t.start_ms), 0) AS durationMs,
      (SELECT COALESCE(SUM(size_bytes), 0) FROM files WHERE missing_since IS NULL) AS sizeBytes,
      COALESCE(SUM(f.is_lossless), 0) AS losslessTracks
    FROM tracks t JOIN files f ON f.id = t.file_id
    WHERE ${PRESENT}`);
  const unreadFiles = db.prepare<[], { count: number }>(
    'SELECT COUNT(*) AS count FROM files WHERE missing_since IS NULL AND has_replaygain IS NULL',
  );
  const unmeasuredArt = db.prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM art WHERE width IS NULL');

  return {
    stored(): StoredReport {
      return {
        summary: summary.get() ?? { tracks: 0, albums: 0, artists: 0, durationMs: 0, sizeBytes: 0, losslessTracks: 0 },
        counts: Object.fromEntries(counts.map(({ id, statement }) => [id, statement.get()?.count ?? 0])),
        unreadFiles: unreadFiles.get()?.count ?? 0,
        unmeasuredArt: unmeasuredArt.get()?.count ?? 0,
      };
    },
    trackIds(check: CheckDefinition): number[] {
      return db
        .prepare<[], { id: number }>(check.sql)
        .all()
        .map(({ id }) => id);
    },
  };
}

type StillReading = {
  fileFacts: boolean;
  artSizes: boolean;
};

function isStillChecking(needs: Needs | undefined, reading: StillReading): boolean {
  if (needs === 'file-facts') return reading.fileFacts;
  return needs === 'art-sizes' && reading.artSizes;
}

/** The answers with the words that go with them. */
export function buildReport({ summary, counts }: StoredReport, reading: StillReading): LibraryReport {
  const groups: ReportGroup[] = REPORT_GROUPS.map(({ name, checks }) => ({
    name,
    checks: checks.map(({ id, name: checkName, description, needs, isInfo, opensData, shows }) => ({
      id,
      name: checkName,
      description,
      count: counts[id] ?? 0,
      isInfo: isInfo ?? false,
      isChecking: isStillChecking(needs, reading),
      opensData: opensData ?? false,
      shows: shows ?? 'tracks',
    })),
  }));
  return { summary, groups };
}
