import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOverflowChains } from './overflowChains.mjs';
import {
  afterVarint,
  createRecord,
  forEachTableCell,
  isFieldLocal,
  isTableLeafPage,
  localPayloadSize,
  NOT_LOCAL,
  parseCellRecord,
  parseHeader,
  parseWholeRecord,
  readField,
  readHeader,
  readVarint,
  STOP,
  streamPages,
} from './sqlitePages.mjs';
import { makeTempDir, openDump, removeTempDir, seededRandom } from './testFixtures.mjs';

let dir = '';

beforeAll(() => {
  dir = makeTempDir();
});

afterAll(() => {
  removeTempDir(dir);
});

function buildDatabase(name, fill, { pageSize = 4096 } = {}) {
  const path = join(dir, `${name}.sqlite3`);
  rmSync(path, { force: true });
  const db = new Database(path);
  db.pragma('synchronous = OFF');
  db.pragma(`page_size = ${pageSize}`);
  fill(db);
  db.close();
  return { path, bytes: readFileSync(path) };
}

function pageOf(bytes, pageNumber, pageSize) {
  return bytes.subarray((pageNumber - 1) * pageSize, pageNumber * pageSize);
}

/** Every row in a database file, with the record's fields decoded through `read`. */
function readAllCells(bytes, read) {
  const header = parseHeader(bytes);
  const rows = new Map();
  for (let pageNumber = 1; pageNumber <= header.pageCount; pageNumber += 1) {
    const page = pageOf(bytes, pageNumber, header.pageSize);
    if (!isTableLeafPage(page, pageNumber, header)) continue;
    const unreadable = forEachTableCell(page, pageNumber, header, (leaf, cell) => {
      rows.set(`${pageNumber}:${cell.rowid}`, read(leaf, cell, header));
    });
    expect(unreadable).toBe(0);
  }
  return rows;
}

function patched(bytes, patch) {
  const copy = Buffer.from(bytes);
  patch(copy);
  return copy;
}

/** A cell's whole payload, read from the file the way the extract reads it. */
function joinedPayload(bytes, header, leaf, cell) {
  if (cell.overflowPage === 0) return Buffer.from(leaf.subarray(cell.localStart, cell.localStart + cell.localSize));

  let joined = null;
  const chains = createOverflowChains(header, {
    onRowWhole(_rowid, payload) {
      joined = payload;
    },
    onRowBroken(rowid) {
      throw new Error(`The chain of row ${rowid} is broken`);
    },
  });
  chains.start(cell.rowid, leaf, cell);
  const readEveryPage = () => {
    for (let pageNumber = 1; pageNumber <= header.pageCount; pageNumber += 1) {
      chains.offerPage(pageOf(bytes, pageNumber, header.pageSize), pageNumber);
    }
  };
  readEveryPage();
  chains.layOutRemainingPages();
  readEveryPage();
  return joined;
}

describe('parseHeader', () => {
  const smallDatabase = () => buildDatabase('header', (db) => db.exec('CREATE TABLE t (a); INSERT INTO t VALUES (1)'));

  it('reads the page size, page count and spill limits', () => {
    const { bytes } = smallDatabase();
    expect(parseHeader(bytes)).toEqual({
      pageSize: 4096,
      usableSize: 4096,
      pageCount: 2,
      lockBytePage: 0,
      maxLocal: 4061,
      minLocal: 489,
    });
  });

  it('takes a page size of 1 to mean 65536, and subtracts reserved bytes from the usable size', () => {
    const { bytes } = smallDatabase();
    const header = parseHeader(
      patched(bytes, (copy) => {
        copy.writeUInt16BE(1, 16);
        copy[20] = 32;
      }),
    );
    expect(header.pageSize).toBe(65536);
    expect(header.usableSize).toBe(65504);
    expect(header.maxLocal).toBe(65469);
    expect(header.minLocal).toBe(8195);
  });

  it('finds the lock-byte page only in a file past 1 GiB', () => {
    const { bytes } = smallDatabase();
    const withPages = (count) => parseHeader(patched(bytes, (copy) => copy.writeUInt32BE(count, 28))).lockBytePage;
    expect(withPages(2 ** 18)).toBe(0);
    expect(withPages(2 ** 18 + 1)).toBe(262145);
  });

  it.each([
    ['a file that is not SQLite', (copy) => copy.write('Not a database!', 0), "isn't a SQLite database"],
    ['a page size that is not a power of two', (copy) => copy.writeUInt16BE(1000, 16), 'Invalid page size'],
    ['too few usable bytes', (copy) => copy.writeUInt16BE(512, 16) && (copy[20] = 33), 'Invalid usable'],
    ['UTF-16 text', (copy) => copy.writeUInt32BE(2, 56), 'encoding 2'],
    ['free pages', (copy) => copy.writeUInt32BE(3, 36), '3 free pages'],
    ['no page count', (copy) => copy.writeUInt32BE(0, 28), 'page count'],
    ['a stale page count', (copy) => copy.writeUInt32BE(99, 92), 'page count'],
    ['too many pages to tell apart', (copy) => copy.writeUInt32BE(0x0d000000, 28), 'too many'],
  ])('refuses %s', (_name, patch, message) => {
    const { bytes } = smallDatabase();
    expect(() => parseHeader(patched(bytes, patch))).toThrow(message);
  });

  it('refuses a real database with free pages', () => {
    const { bytes } = buildDatabase('free-pages', (db) => {
      db.exec(`CREATE TABLE t (a); INSERT INTO t VALUES (zeroblob(50000)); DELETE FROM t`);
      expect(db.pragma('freelist_count', { simple: true })).toBeGreaterThan(0);
    });
    expect(() => parseHeader(bytes)).toThrow('free pages');
  });
});

describe('readVarint', () => {
  it.each([
    [[0x00], 0],
    [[0x7f], 127],
    [[0x81, 0x00], 128],
    [[0xff, 0x7f], 16383],
    [[0x81, 0x80, 0x00], 16384],
    [[0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f], 2 ** 49 - 1],
    [[0x81, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x00], 2 ** 49],
    [[0x8f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f], Number.MAX_SAFE_INTEGER],
    [[0x90, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x00], 2n ** 53n],
    [[0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff], -1],
    [[0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00], -256],
    [[0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x00], 0],
    [[0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f], 2n ** 56n - 1n],
    [[0xbf, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff], 2n ** 63n - 1n],
    [[0xc0, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x00], -(2n ** 63n)],
  ])('reads %j as %s', (bytes, value) => {
    const buffer = Buffer.from([0xaa, ...bytes, 0xaa]);
    expect(readVarint(buffer, 1, buffer.length)).toBe(value);
    expect(afterVarint).toBe(1 + bytes.length);
  });

  it('reports a varint that runs off the end', () => {
    const buffer = Buffer.from([0x81, 0x81, 0x81]);
    readVarint(buffer, 0, buffer.length);
    expect(afterVarint).toBe(Infinity);
    readVarint(buffer, afterVarint, buffer.length);
    expect(afterVarint).toBe(Infinity);
  });
});

describe('localPayloadSize', () => {
  const limits = (usableSize) => ({
    usableSize,
    maxLocal: usableSize - 35,
    minLocal: Math.floor(((usableSize - 12) * 32) / 255) - 23,
  });

  it.each([
    [0, 0],
    [4061, 4061],
    [4062, 489],
    [4100, 489],
    [4580, 489],
    [4581, 489],
    [4582, 490],
    [5000, 908],
    [8153, 4061],
    [8154, 489],
    [8672, 489],
    [8673, 489],
    [8674, 490],
  ])('keeps the right part of %d bytes on a 4096-byte page', (payloadSize, local) => {
    expect(localPayloadSize(payloadSize, limits(4096))).toBe(local);
  });

  it('works from the usable size, not the page size', () => {
    expect(limits(4064).maxLocal).toBe(4029);
    expect(limits(4064).minLocal).toBe(485);
    expect(localPayloadSize(4029, limits(4064))).toBe(4029);
    expect(localPayloadSize(4030, limits(4064))).toBe(485);
    expect(localPayloadSize(485 + 4060, limits(4064))).toBe(485);
    expect(localPayloadSize(485 + 4061, limits(4064))).toBe(486);
  });
});

describe('records, with real SQLite as the oracle', () => {
  const VALUES = [
    [null, 0],
    [0, 8],
    [1, 9],
    [2, 1],
    [-1, 1],
    [127, 1],
    [-128, 1],
    [128, 2],
    [-129, 2],
    [32767, 2],
    [-32768, 2],
    [32768, 3],
    [-32769, 3],
    [8388607, 3],
    [-8388608, 3],
    [8388608, 4],
    [-8388609, 4],
    [2147483647, 4],
    [-2147483648, 4],
    [2147483648, 5],
    [-2147483649, 5],
    [140737488355327, 5],
    [-140737488355328, 5],
    [140737488355328, 6],
    [-140737488355329, 6],
    [9007199254740991, 6],
    [9007199254740992n, 6],
    [9223372036854775807n, 6],
    [-9223372036854775808n, 6],
    [1.5, 7],
    [-0.25, 7],
    [1e300, 7],
    ['', 13],
    ['a', 15],
    ['grüße € 𝄞', 13 + 2 * Buffer.byteLength('grüße € 𝄞')],
    [Buffer.alloc(0), 12],
    [Buffer.from([0, 1, 2, 255]), 20],
  ];

  it('decodes every serial type the way SQLite does', () => {
    const { bytes } = buildDatabase('all-types', (db) => {
      db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, a, b)');
      // better-sqlite3 binds every JS number as a double, and only a bigint as an integer.
      const insert = db.prepare('INSERT INTO t (id, a, b) VALUES (?, ?, 5)');
      VALUES.forEach(([value], index) => insert.run(index + 1, Number.isSafeInteger(value) ? BigInt(value) : value));
    });

    const record = createRecord();
    const decoded = new Map();
    for (const row of readAllCells(bytes, (leaf, cell) => {
      if (!parseCellRecord(leaf, cell, record) || record.count !== 3) return null;
      return { rowid: cell.rowid, type: record.types[1], value: readField(record, 1), tail: readField(record, 2) };
    }).values()) {
      if (row !== null) decoded.set(row.rowid, row);
    }

    const oracle = new Database(join(dir, 'all-types.sqlite3'), { readonly: true });
    oracle.defaultSafeIntegers(true);
    const fromSqlite = oracle.prepare('SELECT a FROM t WHERE id = ?').pluck();
    VALUES.forEach(([value, type], index) => {
      const row = decoded.get(index + 1);
      expect(row?.type).toBe(type);
      expect(row?.tail).toBe(5);
      const expected = fromSqlite.get(BigInt(index + 1));
      if (typeof expected === 'bigint') expect(BigInt(row.value)).toBe(expected);
      else expect(row.value).toEqual(expected);
      expect(row.value).toEqual(value);
    });
    oracle.close();
  });

  it('stores whole numbers in a FLOAT column as integers, and they decode to the same number', () => {
    const durations = [
      [0, 8],
      [1, 9],
      [200, 2],
      [-1, 1],
      [70000, 3],
      [2 ** 31, 5],
      [199.5, 7],
      [200.25, 7],
    ];
    const { bytes, path } = buildDatabase('durations', (db) => {
      db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, duration FLOAT)');
      const insert = db.prepare('INSERT INTO t (duration) VALUES (?)');
      for (const [duration] of durations) insert.run(duration);
    });

    const record = createRecord();
    const cells = [
      ...readAllCells(bytes, (leaf, cell) => {
        parseCellRecord(leaf, cell, record);
        return { count: record.count, rowid: cell.rowid, type: record.types[1], value: readField(record, 1) };
      }).values(),
    ].filter(({ count, type }) => count === 2 && type !== undefined && typeof type === 'number');

    const oracle = new Database(path, { readonly: true });
    const fromSqlite = oracle.prepare('SELECT duration FROM t WHERE id = ?').pluck();
    durations.forEach(([duration, type], index) => {
      const cell = cells.find(({ rowid }) => rowid === index + 1);
      expect(cell?.type).toBe(type);
      expect(cell?.value).toBe(duration);
      expect(fromSqlite.get(index + 1)).toBe(duration);
    });
    oracle.close();
  });

  it('reports a field past the local part, and reads it once the overflow pages are joined', () => {
    const first = 'first';
    const straddling = '€'.repeat(5000);
    const last = 'last';
    const { bytes, path } = buildDatabase('spilled', (db) => {
      db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, a, b, c, d)');
      db.prepare('INSERT INTO t (a, b, c, d) VALUES (?, ?, ?, 7)').run(first, straddling, last);
    });
    const header = parseHeader(bytes);
    const record = createRecord();
    const page = pageOf(bytes, 2, header.pageSize);

    let payload = null;
    forEachTableCell(page, 2, header, (leaf, cell) => {
      expect(cell.overflowPage).toBeGreaterThan(0);
      expect(cell.localSize).toBeLessThan(cell.payloadSize);
      expect(parseCellRecord(leaf, cell, record)).toBe(true);
      expect(record.count).toBe(5);
      expect(readField(record, 0)).toBeNull();
      expect(readField(record, 1)).toBe(first);
      expect(isFieldLocal(record, 1)).toBe(true);
      expect(readField(record, 2)).toBe(NOT_LOCAL);
      expect(isFieldLocal(record, 2)).toBe(false);
      expect(readField(record, 3)).toBe(NOT_LOCAL);
      expect(readField(record, 4)).toBe(NOT_LOCAL);
      payload = joinedPayload(bytes, header, leaf, cell);
    });

    expect(parseWholeRecord(payload, record)).toBe(true);
    const oracle = new Database(path, { readonly: true });
    const row = oracle.prepare('SELECT * FROM t').get();
    expect(readField(record, 1)).toBe(row.a);
    expect(readField(record, 2)).toBe(row.b);
    expect(readField(record, 3)).toBe(row.c);
    expect(readField(record, 4)).toBe(row.d);
    oracle.close();
  });
});

function btreePages(path) {
  const db = new Database(path, { readonly: true });
  const withoutRowid = new Set(
    db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND sql LIKE '%WITHOUT ROWID%'").pluck().all(),
  );
  const indexes = new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type = 'index'").pluck().all());
  const leaves = db
    .prepare("SELECT name, pageno FROM dbstat WHERE pagetype = 'leaf'")
    .all()
    .filter(({ name }) => !withoutRowid.has(name) && !indexes.has(name))
    .map(({ pageno }) => pageno);
  db.close();
  return new Set(leaves);
}

function fillDump(dump, rows) {
  dump.db.exec('BEGIN');
  for (let i = 0; i < rows; i += 1) {
    const trackId = dump.addTrack({ name: `Song ${i}`, artist: 'Artist', album: 'Album', duration: 100 + i });
    dump.addLyrics(trackId, {
      plain: 'la '.repeat(i * 7),
      synced: i % 2 === 0 ? '[00:01.00] la\n'.repeat(i * 3) : null,
    });
    dump.addMissingTrack({ name: `Missing ${i}`, artist: 'Artist', album: 'Album', duration: 100 + i });
  }
  dump.db.exec('COMMIT');
}

describe('isTableLeafPage, with dbstat as the oracle', () => {
  it.each([
    ['a dump-shaped database', 'plain', {}],
    ['one under auto-vacuum, with pointer map pages', 'auto-vacuum', { autoVacuum: true }],
    ['one with small pages', 'small-pages', { pageSize: 512 }],
  ])('finds exactly the table leaves of %s', (_name, file, options) => {
    const path = join(dir, `${file}.sqlite3`);
    const dump = openDump(path, options);
    fillDump(dump, 300);
    dump.finish();

    const bytes = readFileSync(path);
    const header = parseHeader(bytes);
    const found = new Set();
    for (let pageNumber = 1; pageNumber <= header.pageCount; pageNumber += 1) {
      if (isTableLeafPage(pageOf(bytes, pageNumber, header.pageSize), pageNumber, header)) found.add(pageNumber);
    }
    expect(found).toEqual(btreePages(path));
  });

  it("isn't fooled by pointer map pages", () => {
    const path = join(dir, 'pointer-map.sqlite3');
    const dump = openDump(path, { autoVacuum: true });
    fillDump(dump, 300);
    dump.finish();

    const bytes = readFileSync(path);
    expect(bytes.readUInt32BE(52)).toBeGreaterThan(0);
    const header = parseHeader(bytes);
    const perPointerMap = Math.floor(header.usableSize / 5) + 1;
    expect(header.pageCount).toBeGreaterThan(2);
    for (let pageNumber = 2; pageNumber <= header.pageCount; pageNumber += perPointerMap) {
      const firstEntry = bytes[(pageNumber - 1) * header.pageSize];
      expect(firstEntry).toBeGreaterThanOrEqual(1);
      expect(firstEntry).toBeLessThanOrEqual(5);
    }
  });

  it('skips the lock-byte page, whatever it holds', () => {
    const page = Buffer.alloc(4096);
    page[0] = 0x0d;
    const header = { lockBytePage: 262145 };
    expect(isTableLeafPage(page, 262145, header)).toBe(false);
    expect(isTableLeafPage(page, 262144, header)).toBe(true);
  });
});

describe('malformed input', () => {
  const HEADER = { pageSize: 4096, usableSize: 4096, pageCount: 100, lockBytePage: 0, maxLocal: 4061, minLocal: 489 };

  function leafPage(cells) {
    const page = Buffer.alloc(HEADER.pageSize);
    page[0] = 0x0d;
    page.writeUInt16BE(cells.length, 3);
    let contentAt = HEADER.pageSize;
    cells.forEach((cell, index) => {
      contentAt -= cell.length;
      Buffer.from(cell).copy(page, contentAt);
      page.writeUInt16BE(contentAt, 8 + index * 2);
    });
    return page;
  }

  const countCells = (page) => {
    let readable = 0;
    const unreadable = forEachTableCell(page, 2, HEADER, () => {
      readable += 1;
    });
    return { readable, unreadable };
  };

  const VALID_CELL = [3, 7, 2, 0, 1];

  it('reads a sound cell', () => {
    expect(countCells(leafPage([VALID_CELL]))).toEqual({ readable: 1, unreadable: 0 });
  });

  it.each([
    ['a payload size past the limit', [0xff, 0xff, 0xff, 0xff, 0x7f, 7]],
    ['a negative payload size', [...Array(9).fill(0xff), 7]],
    ['a varint running off the page', Array(4).fill(0x81)],
  ])('counts %s', (_name, cell) => {
    const page = leafPage([cell]);
    if (cell.length === 4) {
      page.fill(0x81, 4096 - 4);
    }
    expect(countCells(page)).toEqual({ readable: 0, unreadable: 1 });
  });

  it('counts a local part that overruns the page', () => {
    const page = leafPage([[0x80 + 31, 0x7f, 7]]);
    expect(countCells(page)).toEqual({ readable: 0, unreadable: 1 });
  });

  it('counts a spilled cell whose overflow page is 0, or past the end of the file', () => {
    // 4100 bytes of payload keeps 489 on the page, and the overflow pointer sits after them.
    const cell = (overflowPage) => {
      const bytes = Buffer.alloc(3 + 489 + 4);
      bytes[0] = 0x80 + 32;
      bytes[1] = 4;
      bytes[2] = 7;
      bytes.writeUInt32BE(overflowPage, 3 + 489);
      return [...bytes];
    };
    expect(countCells(leafPage([cell(5)]))).toEqual({ readable: 1, unreadable: 0 });
    expect(countCells(leafPage([cell(0)]))).toEqual({ readable: 0, unreadable: 1 });
    expect(countCells(leafPage([cell(101)]))).toEqual({ readable: 0, unreadable: 1 });
  });

  it('counts a cell pointer into the pointer array, or past the usable size', () => {
    const page = leafPage([VALID_CELL, VALID_CELL]);
    page.writeUInt16BE(2, 8);
    page.writeUInt16BE(4096, 10);
    expect(countCells(page)).toEqual({ readable: 0, unreadable: 2 });
  });

  it('counts every cell of a page whose pointer array overruns it', () => {
    const page = Buffer.alloc(4096);
    page[0] = 0x0d;
    page.writeUInt16BE(5000, 3);
    expect(countCells(page)).toEqual({ readable: 0, unreadable: 5000 });
  });

  const parse = (bytes, payloadSize = bytes.length, localSize = bytes.length) =>
    parseCellRecord(Buffer.from(bytes), { localStart: 0, localSize, payloadSize }, createRecord());

  it.each([
    ['an empty payload', [], 0],
    ['a header size of 0', [0, 0], 2],
    ['a header bigger than the payload', [9, 1, 1], 3],
    ['a header size that runs off the end', [0x81], 1],
    ['a serial type that runs off the header', [2, 0x81], 2],
    ['a serial type that runs off the header, with a body', [2, 0x81, 0], 3],
    ['reserved serial type 10', [2, 10], 2],
    ['reserved serial type 11', [2, 11], 2],
    ['a negative serial type', [10, ...Array(9).fill(0xff)], 10],
    ['a serial type past 2^53', [10, 0x90, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x00], 10],
    ['fields that overrun the payload', [2, 4, 0, 0], 4],
    ['fields that stop short of the payload', [2, 1, 0, 0], 4],
  ])('rejects %s', (_name, bytes, payloadSize) => {
    expect(parse(bytes, payloadSize)).toBe(false);
  });

  it('rejects a record whose header sits past the local part', () => {
    expect(parse([3, 1, 1, 7, 7], 5, 2)).toBe(false);
  });

  it('accepts the record those are all broken forms of', () => {
    expect(parse([3, 1, 13, 7])).toBe(true);
  });

  it('never throws or hangs on garbage', () => {
    const { bytes } = buildDatabase('fuzz', (db) => {
      db.exec(`CREATE TABLE t (id INTEGER PRIMARY KEY, a, b, c)`);
      const insert = db.prepare('INSERT INTO t (a, b, c) VALUES (?, ?, ?)');
      for (let i = 0; i < 400; i += 1) insert.run(`text ${i}`, i * 1000.5, 'more '.repeat(i));
    });
    const header = parseHeader(bytes);
    const leaves = [];
    for (let pageNumber = 2; pageNumber <= header.pageCount; pageNumber += 1) {
      const page = pageOf(bytes, pageNumber, header.pageSize);
      if (isTableLeafPage(page, pageNumber, header)) leaves.push(page);
    }
    expect(leaves.length).toBeGreaterThan(1);

    const random = seededRandom(1);
    const record = createRecord();
    let cellsTried = 0;
    let recordsParsed = 0;
    const onCell = (leaf, cell) => {
      cellsTried += 1;
      if (!parseCellRecord(leaf, cell, record)) return;
      recordsParsed += 1;
      for (let i = 0; i < record.count; i += 1) readField(record, i);
    };
    for (let round = 0; round < 3000; round += 1) {
      const page = Buffer.from(leaves[Math.floor(random() * leaves.length)]);
      const damage = 1 + Math.floor(random() * 40);
      for (let i = 0; i < damage; i += 1) page[Math.floor(random() * page.length)] = Math.floor(random() * 256);
      page[0] = 0x0d;
      expect(() => forEachTableCell(page, 2, header, onCell)).not.toThrow();
    }
    expect(cellsTried).toBeGreaterThan(0);
    expect(recordsParsed).toBeGreaterThan(0);
  });
});

function varint(value) {
  const bytes = [value % 128];
  for (let rest = Math.floor(value / 128); rest > 0; rest = Math.floor(rest / 128)) bytes.unshift((rest % 128) | 0x80);
  return bytes;
}

function recordOf(values) {
  const bodies = values.map((value) => {
    if (typeof value === 'string') return Buffer.from(value);
    const twoBytes = Buffer.alloc(2);
    twoBytes.writeUInt16BE(value);
    return twoBytes;
  });
  const types = values.flatMap((value, index) =>
    typeof value === 'string' ? varint(13 + 2 * bodies[index].length) : [2],
  );
  return Buffer.concat([Buffer.from([1 + types.length, ...types]), ...bodies]);
}

/**
 * SQLite won't write reserved bytes through better-sqlite3, so this lays out a file by hand, one table per text with a
 * single leaf page, and SQLite has to accept it. localPayloadSize decides the spilling, since that's what's on trial.
 */
function writeReservedBytesDatabase(path, reserved, texts) {
  const pageSize = 4096;
  const usableSize = pageSize - reserved;
  const limits = {
    usableSize,
    maxLocal: usableSize - 35,
    minLocal: Math.floor(((usableSize - 12) * 32) / 255) - 23,
  };

  const pages = [];
  const addPage = () => {
    pages.push(Buffer.alloc(pageSize));
    return pages.length;
  };
  const addLeafPage = (headerAt = 0) => {
    const pageNumber = addPage();
    const page = pages[pageNumber - 1];
    page[headerAt] = 0x0d;
    page.writeUInt16BE(usableSize, headerAt + 5);
    return pageNumber;
  };
  const addCell = (pageNumber, headerAt, cell) => {
    const page = pages[pageNumber - 1];
    const count = page.readUInt16BE(headerAt + 3);
    const at = page.readUInt16BE(headerAt + 5) - cell.length;
    cell.copy(page, at);
    page.writeUInt16BE(at, headerAt + 8 + count * 2);
    page.writeUInt16BE(count + 1, headerAt + 3);
    page.writeUInt16BE(at, headerAt + 5);
  };
  const addOverflowPages = (bytes) => {
    const firstPage = pages.length + 1;
    const perPage = usableSize - 4;
    for (let at = 0; at < bytes.length; at += perPage) {
      const page = pages[addPage() - 1];
      bytes.copy(page, 4, at, Math.min(at + perPage, bytes.length));
      page.writeUInt32BE(at + perPage < bytes.length ? pages.length + 1 : 0, 0);
    }
    return firstPage;
  };
  const cellOf = (rowid, payload) => {
    const local = localPayloadSize(payload.length, limits);
    const parts = [Buffer.from([...varint(payload.length), ...varint(rowid)]), payload.subarray(0, local)];
    if (local < payload.length) {
      const pointer = Buffer.alloc(4);
      pointer.writeUInt32BE(addOverflowPages(payload.subarray(local)));
      parts.push(pointer);
    }
    return Buffer.concat(parts);
  };

  const SCHEMA_PAGE_HEADER_AT = 100;
  addLeafPage(SCHEMA_PAGE_HEADER_AT);
  texts.forEach((text, index) => {
    const root = addLeafPage();
    addCell(root, 0, cellOf(1, recordOf([text])));
    const name = `t${index}`;
    const schemaRow = recordOf(['table', name, name, root, `CREATE TABLE ${name} (a)`]);
    addCell(1, SCHEMA_PAGE_HEADER_AT, cellOf(index + 1, schemaRow));
  });

  const first = pages[0];
  first.write('SQLite format 3\0', 0, 'latin1');
  first.writeUInt16BE(pageSize, 16);
  first[18] = 1;
  first[19] = 1;
  first[20] = reserved;
  first[21] = 64;
  first[22] = 32;
  first[23] = 32;
  first.writeUInt32BE(1, 24);
  first.writeUInt32BE(pages.length, 28);
  first.writeUInt32BE(1, 40);
  first.writeUInt32BE(4, 44);
  first.writeUInt32BE(1, 56);
  first.writeUInt32BE(1, 92);
  first.writeUInt32BE(3049002, 96);

  // Anything wrongly read out of the reserved bytes would show up in the text.
  for (const page of pages) page.fill(0xee, usableSize);
  writeFileSync(path, Buffer.concat(pages));
}

describe('reserved bytes', () => {
  it('reads what SQLite reads when pages keep bytes in reserve', () => {
    const reserved = 32;
    const usableSize = 4096 - reserved;
    const maxLocal = usableSize - 35;
    const minLocal = Math.floor(((usableSize - 12) * 32) / 255) - 23;
    const perPage = usableSize - 4;
    // Three bytes of record header come on top of a text this long, or four once its serial type takes three bytes.
    const texts = [
      '',
      'short',
      ...[minLocal, maxLocal - 1, maxLocal, maxLocal + 1, minLocal + perPage, minLocal + perPage + 1].map((payload) =>
        'x'.repeat(payload - 3),
      ),
      'é'.repeat(9000),
      '€'.repeat(30000),
    ];
    const path = join(dir, 'reserved.sqlite3');
    writeReservedBytesDatabase(path, reserved, texts);

    const oracle = new Database(path, { readonly: true });
    expect(oracle.pragma('integrity_check', { simple: true })).toBe('ok');
    texts.forEach((text, index) => {
      expect(oracle.prepare(`SELECT a FROM t${index}`).pluck().get()).toBe(text);
    });
    oracle.close();

    const bytes = readFileSync(path);
    const header = parseHeader(bytes);
    expect(header.usableSize).toBe(usableSize);
    const record = createRecord();
    const fromReader = [];
    for (let pageNumber = 2; pageNumber <= header.pageCount; pageNumber += 1) {
      const page = pageOf(bytes, pageNumber, header.pageSize);
      if (!isTableLeafPage(page, pageNumber, header)) continue;
      const unreadable = forEachTableCell(page, pageNumber, header, (leaf, cell) => {
        expect(parseWholeRecord(joinedPayload(bytes, header, leaf, cell), record)).toBe(true);
        fromReader.push(readField(record, 0));
      });
      expect(unreadable).toBe(0);
    }
    expect(fromReader).toEqual(texts);
  });
});

describe('streamPages', () => {
  const PAGES = 50;

  function database(name, { pageSize = 4096 } = {}) {
    const { path, bytes } = buildDatabase(
      name,
      (db) => {
        db.exec('CREATE TABLE t (a)');
        const random = seededRandom(7);
        const insert = db.prepare('INSERT INTO t VALUES (?)');
        for (let i = 0; i < PAGES; i += 1) {
          const noise = Buffer.alloc(pageSize);
          for (let at = 0; at < noise.length; at += 1) noise[at] = Math.floor(random() * 256);
          insert.run(noise);
        }
      },
      { pageSize },
    );
    return { path, bytes, header: parseHeader(bytes) };
  }

  function gz(name, bytes) {
    const path = join(dir, `${name}.gz`);
    writeFileSync(path, gzipSync(bytes, { level: 1 }));
    return path;
  }

  it.each([
    [4096, 1000],
    [4096, 4096],
    [4096, 5000],
    [4096, 2 ** 20],
    [512, 700],
    [65536, 2 ** 16 + 1],
  ])('hands over whole %i-byte pages in order, reading in chunks of %i', async (pageSize, chunkBytes) => {
    const { bytes, header } = database(`stream-${pageSize}-${chunkBytes}`, { pageSize });
    const seen = [];
    const result = await streamPages(
      gz(`stream-${pageSize}-${chunkBytes}`, bytes),
      header,
      (page, pageNumber) => {
        expect(page.length).toBe(pageSize);
        expect(page.equals(pageOf(bytes, pageNumber, pageSize))).toBe(true);
        seen.push(pageNumber);
      },
      { chunkBytes },
    );
    expect(seen).toEqual(Array.from({ length: header.pageCount }, (_, index) => index + 1));
    expect(result).toEqual({ pagesRead: header.pageCount, stoppedEarly: false });
  });

  it('reads the header out of the stream', async () => {
    const { bytes, header } = database('read-header');
    await expect(readHeader(gz('read-header', bytes))).resolves.toEqual(header);
  });

  it('stops when told to, without an error and without another page', async () => {
    const { bytes, header } = database('stop');
    const seen = [];
    const result = await streamPages(gz('stop', bytes), header, (_page, pageNumber) => {
      seen.push(pageNumber);
      return pageNumber === 5 ? STOP : undefined;
    });
    expect(seen).toEqual([1, 2, 3, 4, 5]);
    expect(result).toEqual({ pagesRead: 5, stoppedEarly: true });
  });

  it('can stop in the middle of a chunk, on a page assembled across two', async () => {
    const { bytes, header } = database('stop-straddling');
    const result = await streamPages(
      gz('stop-straddling', bytes),
      header,
      (_page, pageNumber) => (pageNumber === 2 ? STOP : undefined),
      { chunkBytes: 5000 },
    );
    expect(result).toEqual({ pagesRead: 2, stoppedEarly: true });
  });

  it('stopping before the damage is not an error', async () => {
    const { bytes, header } = database('stop-truncated');
    const whole = gzipSync(bytes, { level: 1 });
    const path = join(dir, 'stop-truncated.gz');
    writeFileSync(path, whole.subarray(0, whole.length - 100));
    const result = await streamPages(path, header, (_page, pageNumber) => (pageNumber === 1 ? STOP : undefined));
    expect(result.stoppedEarly).toBe(true);
  });

  const readAll = (path, header) => streamPages(path, header, () => undefined);

  it('rejects a truncated file', async () => {
    const { bytes, header } = database('truncated');
    const whole = gzipSync(bytes, { level: 1 });
    const path = join(dir, 'truncated.gz');
    writeFileSync(path, whole.subarray(0, Math.floor(whole.length / 2)));
    await expect(readAll(path, header)).rejects.toThrow('is truncated or corrupt');
  });

  it('rejects a file cut off just before its checksum', async () => {
    const { bytes, header } = database('no-trailer');
    const whole = gzipSync(bytes, { level: 1 });
    const path = join(dir, 'no-trailer.gz');
    writeFileSync(path, whole.subarray(0, whole.length - 8));
    await expect(readAll(path, header)).rejects.toThrow('is truncated or corrupt');
  });

  it('rejects damage in the middle of the stream', async () => {
    const { bytes, header } = database('corrupt');
    const damaged = gzipSync(bytes, { level: 1 });
    const middle = Math.floor(damaged.length / 2);
    damaged.fill(0x55, middle, middle + 64);
    const path = join(dir, 'corrupt.gz');
    writeFileSync(path, damaged);
    await expect(readAll(path, header)).rejects.toThrow('is truncated or corrupt');
  });

  it('rejects a wrong checksum', async () => {
    const { bytes, header } = database('bad-crc');
    const damaged = gzipSync(bytes, { level: 1 });
    damaged[damaged.length - 8] ^= 0xff;
    const path = join(dir, 'bad-crc.gz');
    writeFileSync(path, damaged);
    await expect(readAll(path, header)).rejects.toThrow('incorrect data check');
  });

  it('rejects a stream shorter than the header promises', async () => {
    const { bytes, header } = database('short');
    const path = gz('short', bytes.subarray(0, bytes.length - 4096));
    await expect(readAll(path, header)).rejects.toThrow('but its header promises');
  });

  it('rejects a stream that ends in part of a page', async () => {
    const { bytes, header } = database('partial');
    const path = gz('partial', bytes.subarray(0, bytes.length - 100));
    await expect(readAll(path, header)).rejects.toThrow('but its header promises');
  });

  it('rejects a stream longer than the header promises', async () => {
    const { bytes, header } = database('long');
    const path = gz('long', Buffer.concat([bytes, Buffer.alloc(4096)]));
    await expect(readAll(path, header)).rejects.toThrow('holds more than');
  });

  it('rejects a file that is not gzip', async () => {
    const { bytes, header } = database('not-gzip');
    const path = join(dir, 'not-gzip.gz');
    writeFileSync(path, bytes);
    await expect(readAll(path, header)).rejects.toThrow('is truncated or corrupt');
  });

  it('rejects a read error instead of hanging', async () => {
    const { header } = database('missing');
    await expect(readAll(join(dir, 'no-such-file.gz'), header)).rejects.toThrow('ENOENT');
  });

  it('rejects a failure partway through reading', async () => {
    const { header } = database('directory');
    await expect(readAll(dir, header)).rejects.toThrow('EISDIR');
  });

  it('rejects when the callback throws', async () => {
    const { bytes, header } = database('throws');
    const read = streamPages(gz('throws', bytes), header, () => {
      throw new Error('callback failed');
    });
    await expect(read).rejects.toThrow('callback failed');
  });
});
