/*
 * SQLite's file format, read forward out of a gzip stream one page at a time, for a database too big to unpack.
 * Knows nothing about what the tables hold. The layouts are in https://www.sqlite.org/fileformat2.html.
 */
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';

export const STOP = Symbol('stop reading');
export const NOT_LOCAL = Symbol('past the local part of the payload');
export const NULL_TYPE = 0;
export const FLOAT_TYPE = 7;
export const OVERFLOW_POINTER_BYTES = 4;

const DEFAULT_CHUNK_BYTES = 2 ** 20;
const MAGIC = 'SQLite format 3\0';
const FILE_HEADER_BYTES = 100;
const UTF8 = 1;
const MIN_PAGE_SIZE = 512;
const MIN_USABLE_SIZE = 480;
const LOCK_BYTE_OFFSET = 2 ** 30;
const TABLE_LEAF_FLAG = 0x0d;
const FIRST_PAGE_NUMBER_STARTING_WITH_LEAF_FLAG = TABLE_LEAF_FLAG * 2 ** 24;
const LEAF_HEADER_BYTES = 8;
const MAX_PAYLOAD_BYTES = 2 ** 31 - 1;
const MAX_FAST_VARINT_BYTES = 7;
const MAX_VARINT_BYTES = 9;
const FIXED_CONTENT_BYTES = [0, 1, 2, 3, 4, 6, 8, 8, 0, 0];

export function parseHeader(bytes) {
  if (bytes.length < FILE_HEADER_BYTES || bytes.toString('latin1', 0, MAGIC.length) !== MAGIC) {
    throw new Error("This isn't a SQLite database: the first page doesn't start with SQLite's header");
  }
  const rawPageSize = bytes.readUInt16BE(16);
  const pageSize = rawPageSize === 1 ? 65536 : rawPageSize;
  if (pageSize < MIN_PAGE_SIZE || (pageSize & (pageSize - 1)) !== 0) throw new Error(`Invalid page size ${pageSize}`);

  const usableSize = pageSize - bytes[20];
  if (usableSize < MIN_USABLE_SIZE) throw new Error(`Invalid usable page size ${usableSize}`);

  const encoding = bytes.readUInt32BE(56);
  if (encoding !== UTF8) throw new Error(`Only UTF-8 databases can be read, and this one has encoding ${encoding}`);

  const pageCount = bytes.readUInt32BE(28);
  if (pageCount === 0 || bytes.readUInt32BE(24) !== bytes.readUInt32BE(92)) {
    throw new Error("The header's page count isn't valid, and a stream has no file size to fall back on");
  }
  if (pageCount >= FIRST_PAGE_NUMBER_STARTING_WITH_LEAF_FLAG) {
    throw new Error(`${pageCount} pages is too many to tell overflow pages from table leaf pages by their first byte`);
  }

  const freePages = bytes.readUInt32BE(36);
  if (freePages !== 0) {
    throw new Error(`${freePages} free pages: a forward-only read can't tell a free page from a live one`);
  }

  return {
    pageSize,
    usableSize,
    pageCount,
    lockBytePage: pageSize * pageCount > LOCK_BYTE_OFFSET ? Math.floor(LOCK_BYTE_OFFSET / pageSize) + 1 : 0,
    maxLocal: usableSize - 35,
    minLocal: Math.floor(((usableSize - 12) * 32) / 255) - 23,
  };
}

function isZlibFailure(error) {
  return typeof error.code === 'string' && error.code.startsWith('Z_');
}

async function readChunks(path, chunkBytes, onChunk) {
  let stopped = false;
  try {
    await pipeline(
      createReadStream(path, { highWaterMark: chunkBytes }),
      createGunzip({ chunkSize: chunkBytes }),
      async (chunks) => {
        for await (const chunk of chunks) {
          if (onChunk(chunk) === STOP) {
            stopped = true;
            return;
          }
        }
      },
    );
  } catch (error) {
    // Stopping early destroys the gunzip mid-stream, and the pipeline reports that as a premature close.
    if (stopped) return true;
    if (isZlibFailure(error)) throw new Error(`${path} is truncated or corrupt: ${error.message}`, { cause: error });
    throw error;
  }
  return stopped;
}

export async function readHeader(path) {
  const chunks = [];
  let bytes = 0;
  await readChunks(path, DEFAULT_CHUNK_BYTES, (chunk) => {
    chunks.push(chunk);
    bytes += chunk.length;
    return bytes >= FILE_HEADER_BYTES ? STOP : undefined;
  });
  return parseHeader(Buffer.concat(chunks));
}

/**
 * Hands every page to `onPage(page, pageNumber)` in file order, until it returns STOP. The view is only valid during
 * the call. Reading to the end also proves the gzip checksum and the size the header promised, or it rejects.
 */
export async function streamPages(path, header, onPage, { chunkBytes = DEFAULT_CHUNK_BYTES } = {}) {
  const { pageSize } = header;
  const expectedBytes = pageSize * header.pageCount;
  const straddling = Buffer.allocUnsafe(pageSize);
  let straddlingBytes = 0;
  let pagesRead = 0;
  let totalBytes = 0;

  const deliver = (page) => {
    pagesRead += 1;
    return onPage(page, pagesRead);
  };

  const onChunk = (chunk) => {
    totalBytes += chunk.length;
    if (totalBytes > expectedBytes) throw new Error(`${path} holds more than the ${expectedBytes} bytes it promises`);
    let at = 0;
    if (straddlingBytes > 0) {
      at = chunk.copy(straddling, straddlingBytes);
      straddlingBytes += at;
      if (straddlingBytes < pageSize) return undefined;
      straddlingBytes = 0;
      if (deliver(straddling) === STOP) return STOP;
    }
    for (; at + pageSize <= chunk.length; at += pageSize) {
      if (deliver(chunk.subarray(at, at + pageSize)) === STOP) return STOP;
    }
    straddlingBytes = chunk.copy(straddling, 0, at);
    return undefined;
  };

  const stoppedEarly = await readChunks(path, chunkBytes, onChunk);
  if (!stoppedEarly && totalBytes !== expectedBytes) {
    throw new Error(`${path} unpacks to ${totalBytes} bytes, but its header promises ${expectedBytes}`);
  }
  return { pagesRead, stoppedEarly };
}

/*
 * A first byte of 0x0D means a table leaf on every page but two. Overflow and freelist trunk pages start with a page
 * number, which would have to be 218,103,808 or more, and parseHeader refuses files that big. Pointer map pages, which
 * exist under auto-vacuum, start with an entry type of 1 to 5. Freelist leaves can hold anything, so parseHeader refuses
 * any free pages. The exceptions: page 1 keeps its flag after the file header, and the lock-byte page is never written
 * by SQLite and could hold anything, so it's skipped by number.
 */
export function isTableLeafPage(page, pageNumber, header) {
  return page[pageNumber === 1 ? FILE_HEADER_BYTES : 0] === TABLE_LEAF_FLAG && pageNumber !== header.lockBytePage;
}

// JS can't return two values without allocating, and this runs for every field of tens of millions of cells.
export let afterVarint = 0;

function asSafeNumber(big) {
  const number = Number(big);
  return Number.isSafeInteger(number) ? number : big;
}

function readLongVarint(bytes, at, end) {
  const lastAt = at + MAX_VARINT_BYTES - 1;
  let value = 0n;
  for (let i = at; i <= lastAt; i += 1) {
    if (i >= end) {
      afterVarint = Infinity;
      return 0;
    }
    const byte = bytes[i];
    value = i === lastAt ? (value << 8n) | BigInt(byte) : (value << 7n) | BigInt(byte & 0x7f);
    if (byte < 0x80 || i === lastAt) {
      afterVarint = i + 1;
      break;
    }
  }
  return asSafeNumber(BigInt.asIntN(64, value));
}

/** A number, or a bigint past 2^53. A varint running past `end` sets `afterVarint` to Infinity. */
export function readVarint(bytes, at, end) {
  let value = 0;
  const fastEnd = Math.min(at + MAX_FAST_VARINT_BYTES, end);
  for (let i = at; i < fastEnd; i += 1) {
    const byte = bytes[i];
    value = value * 128 + (byte & 0x7f);
    if (byte < 0x80) {
      afterVarint = i + 1;
      return value;
    }
  }
  return readLongVarint(bytes, at, end);
}

export function localPayloadSize(payloadSize, { usableSize, maxLocal, minLocal }) {
  if (payloadSize <= maxLocal) return payloadSize;
  const surplus = minLocal + ((payloadSize - minLocal) % (usableSize - OVERFLOW_POINTER_BYTES));
  return surplus <= maxLocal ? surplus : minLocal;
}

const reusedCell = { rowid: 0, payloadSize: 0, localStart: 0, localSize: 0, overflowPage: 0 };

function readCell(page, pointer, header) {
  const { usableSize } = header;
  const payloadSize = readVarint(page, pointer, usableSize);
  const rowid = readVarint(page, afterVarint, usableSize);
  const localStart = afterVarint;
  if (localStart > usableSize || !(payloadSize >= 0 && payloadSize <= MAX_PAYLOAD_BYTES)) return false;

  const localSize = localPayloadSize(payloadSize, header);
  const localEnd = localStart + localSize;
  const spills = localSize < payloadSize;
  if (localEnd + (spills ? OVERFLOW_POINTER_BYTES : 0) > usableSize) return false;

  const overflowPage = spills ? page.readUInt32BE(localEnd) : 0;
  if (spills && (overflowPage === 0 || overflowPage > header.pageCount)) return false;

  reusedCell.rowid = rowid;
  reusedCell.payloadSize = payloadSize;
  reusedCell.localStart = localStart;
  reusedCell.localSize = localSize;
  reusedCell.overflowPage = overflowPage;
  return true;
}

/**
 * Calls `onCell(page, cell)` for each readable cell of a table leaf page, and returns how many weren't readable. The
 * same `cell` object comes back every time, so it's only valid during the call.
 */
export function forEachTableCell(page, pageNumber, header, onCell) {
  const pageHeaderAt = pageNumber === 1 ? FILE_HEADER_BYTES : 0;
  const pointersAt = pageHeaderAt + LEAF_HEADER_BYTES;
  const cellCount = page.readUInt16BE(pageHeaderAt + 3);
  const pointersEnd = pointersAt + cellCount * 2;
  if (pointersEnd > header.usableSize) return cellCount;

  let unreadable = 0;
  for (let i = 0; i < cellCount; i += 1) {
    const pointer = page.readUInt16BE(pointersAt + i * 2);
    if (pointer >= pointersEnd && readCell(page, pointer, header)) onCell(page, reusedCell);
    else unreadable += 1;
  }
  return unreadable;
}

function contentBytes(type) {
  return type >= 12 ? Math.floor((type - 12) / 2) : FIXED_CONTENT_BYTES[type];
}

export function isTextType(type) {
  return type >= 13 && type % 2 === 1;
}

export function isIntegerType(type) {
  return (type >= 1 && type <= 6) || type === 8 || type === 9;
}

/** One reusable record, so parsing a cell allocates nothing. It's only good until the bytes it was parsed from go. */
export function createRecord() {
  return { bytes: Buffer.alloc(0), start: 0, available: 0, count: 0, types: [], offsets: [] };
}

function parseRecord(bytes, start, available, payloadSize, record) {
  const headerSize = readVarint(bytes, start, start + available);
  if (!(headerSize > 0 && headerSize <= available)) return false;

  const headerEnd = start + headerSize;
  let at = afterVarint;
  let offset = headerSize;
  let count = 0;
  while (at < headerEnd) {
    const type = readVarint(bytes, at, headerEnd);
    at = afterVarint;
    if (at > headerEnd || typeof type !== 'number' || type < 0 || type === 10 || type === 11) return false;
    record.types[count] = type;
    record.offsets[count] = offset;
    offset += contentBytes(type);
    count += 1;
  }
  record.bytes = bytes;
  record.start = start;
  record.available = available;
  record.count = count;
  return offset === payloadSize;
}

/**
 * Parses as much as a cell's leaf page holds. False means the record can't be read from the local part: its header runs
 * past it (legal in SQLite, but impossible with this dump's few columns), a serial type is reserved, or the fields don't
 * add up to the payload.
 */
export function parseCellRecord(page, cell, record) {
  return parseRecord(page, cell.localStart, cell.localSize, cell.payloadSize, record);
}

/** The same, for a payload that has been joined back together. */
export function parseWholeRecord(payload, record) {
  return parseRecord(payload, 0, payload.length, payload.length, record);
}

export function isFieldLocal(record, index) {
  return record.offsets[index] + contentBytes(record.types[index]) <= record.available;
}

/**
 * NOT_LOCAL means the field runs past the bytes the record was parsed from. Text only decodes correctly from a joined
 * payload, since a character can straddle a page boundary.
 */
export function readField(record, index) {
  if (!isFieldLocal(record, index)) return NOT_LOCAL;
  const { bytes } = record;
  const type = record.types[index];
  const at = record.start + record.offsets[index];
  switch (type) {
    case NULL_TYPE:
      return null;
    case 1:
      return bytes.readInt8(at);
    case 2:
      return bytes.readInt16BE(at);
    case 3:
      return bytes.readIntBE(at, 3);
    case 4:
      return bytes.readInt32BE(at);
    case 5:
      return bytes.readIntBE(at, 6);
    case 6:
      return asSafeNumber(bytes.readBigInt64BE(at));
    case FLOAT_TYPE:
      return bytes.readDoubleBE(at);
    case 8:
      return 0;
    case 9:
      return 1;
    default: {
      const end = at + contentBytes(type);
      return isTextType(type) ? bytes.toString('utf8', at, end) : Buffer.from(bytes.subarray(at, end));
    }
  }
}
