/*
 * What LRCLIB's rows look like as SQLite records. A forward read doesn't know which table a leaf page belongs to, so a
 * row's serial types are what say which table it fits.
 */
import { FLOAT_TYPE, isIntegerType, isTextType, NULL_TYPE, readField } from './sqlitePages.mjs';

export const TRACK_FIELDS = { name: 1, artistName: 3, albumName: 5, duration: 7, lastLyricsId: 8 };
export const STAT1_FIELDS = { table: 0, stat: 2 };

const TRACKS_FIELD_COUNT = 11;
const MIN_LYRICS_FIELD_COUNT = 10;
const LYRICS_COLUMNS = [
  'plain_lyrics',
  'synced_lyrics',
  'track_id',
  'has_plain_lyrics',
  'has_synced_lyrics',
  'instrumental',
  'source',
  'created_at',
  'updated_at',
  'lyricsfile',
  'has_lyricsfile',
  'has_word_sync',
];
// lyricsfile, has_lyricsfile and has_word_sync came from ALTER TABLE, so an older row's record stops before them.
const COLUMN_DEFAULTS = { lyricsfile: null, has_lyricsfile: 0, has_word_sync: 0 };

function isTextOrNull(type) {
  return type === NULL_TYPE || isTextType(type);
}

function isIntegerOrNull(type) {
  return type === NULL_TYPE || isIntegerType(type);
}

// A whole-number duration is stored as an integer, even in a FLOAT column.
function isNumberOrNull(type) {
  return isIntegerOrNull(type) || type === FLOAT_TYPE;
}

export function fitsTracksTable({ count, types }) {
  return (
    count === TRACKS_FIELD_COUNT &&
    types[0] === NULL_TYPE &&
    isTextOrNull(types[1]) &&
    isTextOrNull(types[2]) &&
    isTextOrNull(types[3]) &&
    isTextOrNull(types[4]) &&
    isTextOrNull(types[5]) &&
    isTextOrNull(types[6]) &&
    isNumberOrNull(types[7]) &&
    isIntegerOrNull(types[8])
  );
}

export function fitsLyricsTable({ count, types }) {
  return (
    count >= MIN_LYRICS_FIELD_COUNT &&
    count <= LYRICS_COLUMNS.length + 1 &&
    types[0] === NULL_TYPE &&
    isTextOrNull(types[1]) &&
    isTextOrNull(types[2]) &&
    isIntegerOrNull(types[3]) &&
    isIntegerOrNull(types[4]) &&
    isIntegerOrNull(types[5]) &&
    isIntegerOrNull(types[6])
  );
}

export function fitsSequenceTable({ count, types }) {
  return count === 2 && isTextType(types[0]) && isIntegerType(types[1]);
}

export function fitsStat1Table({ count, types }) {
  return count === 3 && isTextType(types[0]) && isTextOrNull(types[1]) && isTextType(types[2]);
}

/** A tracks row missing any of these can't be matched. An album may be missing. */
export function hasMatchableFields({ types }) {
  const { name, artistName, duration, lastLyricsId } = TRACK_FIELDS;
  return (
    types[name] !== NULL_TYPE &&
    types[artistName] !== NULL_TYPE &&
    types[duration] !== NULL_TYPE &&
    types[lastLyricsId] !== NULL_TYPE
  );
}

/** The record has to hold the whole payload. Every column gets a value, whichever generation of the table it's from. */
export function readLyricsRow(record) {
  const row = {};
  LYRICS_COLUMNS.forEach((column, index) => {
    const field = index + 1;
    row[column] = field < record.count ? readField(record, field) : COLUMN_DEFAULTS[column];
  });
  return row;
}
