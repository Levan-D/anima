import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOverflowChains } from './overflowChains.mjs';

const PAGE_SIZE = 40;
// The reserved bytes past this are never payload. They're filled with a byte no payload holds, so a misread shows.
const USABLE_SIZE = 32;
const BYTES_PER_PAGE = USABLE_SIZE - 4;
const NOT_PAYLOAD = 0xee;
const HEADER = { usableSize: USABLE_SIZE, pageCount: 20 };
const LOCAL_START = 2;
const LOCAL_SIZE = 5;
const LAST_PAGE_BYTES = 10;

function payloadOf({ rowid, chain }) {
  const size = LOCAL_SIZE + (chain.length - 1) * BYTES_PER_PAGE + LAST_PAGE_BYTES;
  return Buffer.from(Array.from({ length: size }, (_, at) => (rowid * 31 + at) % 200));
}

/** A file with each row's cell on its `leaf` page and its overflow pages where `chain` says, in chain order. */
function fileOf(rows) {
  const pages = Array.from({ length: HEADER.pageCount + 1 }, () => Buffer.alloc(PAGE_SIZE, NOT_PAYLOAD));
  for (const row of rows) {
    const spilled = payloadOf(row).subarray(LOCAL_SIZE);
    row.chain.forEach((pageNumber, position) => {
      pages[pageNumber].writeUInt32BE(row.chain[position + 1] ?? 0, 0);
      spilled.copy(pages[pageNumber], 4, position * BYTES_PER_PAGE, (position + 1) * BYTES_PER_PAGE);
    });
  }
  return pages;
}

function setNextPage(pages, pageNumber, nextPage) {
  pages[pageNumber].writeUInt32BE(nextPage, 0);
}

function startFollowing(rows, pages) {
  const whole = [];
  const broken = [];
  const chains = createOverflowChains(HEADER, {
    onRowWhole: (rowid, payload) => whole.push({ rowid, payload }),
    onRowBroken: (rowid) => broken.push(rowid),
  });

  const startRow = (row) => {
    const leaf = Buffer.alloc(PAGE_SIZE, NOT_PAYLOAD);
    payloadOf(row).copy(leaf, LOCAL_START, 0, LOCAL_SIZE);
    chains.start(row.rowid, leaf, {
      localStart: LOCAL_START,
      localSize: LOCAL_SIZE,
      payloadSize: payloadOf(row).length,
      overflowPage: row.chain[0],
    });
  };

  const readEveryPage = (startsRows) => {
    for (let pageNumber = 1; pageNumber <= HEADER.pageCount; pageNumber += 1) {
      chains.offerPage(pages[pageNumber], pageNumber);
      if (startsRows) rows.filter(({ leaf }) => leaf === pageNumber).forEach(startRow);
    }
  };

  return {
    chains,
    whole,
    broken,
    firstRead: () => readEveryPage(true),
    nextRead: () => readEveryPage(false),
  };
}

/** The whole job, as the extract does it: one read, then the layout, then one more read if a row is still owed. */
function follow(rows, pages = fileOf(rows)) {
  const run = startFollowing(rows, pages);
  run.firstRead();
  run.chains.layOutRemainingPages();
  run.nextRead();
  return run;
}

function permutationsOf(items) {
  if (items.length <= 1) return [items];
  return items.flatMap((item, index) =>
    permutationsOf(items.filter((_, other) => other !== index)).map((rest) => [item, ...rest]),
  );
}

function expectWhole(run, rows) {
  expect(run.broken).toEqual([]);
  expect(run.chains.rowsOwed()).toBe(0);
  expect(run.whole).toHaveLength(rows.length);
  for (const row of rows) {
    const handedOver = run.whole.find(({ rowid }) => rowid === row.rowid);
    expect(handedOver?.payload.equals(payloadOf(row)), `row ${row.rowid}`).toBe(true);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a chain that only runs forward', () => {
  it('is finished by the read that started it', () => {
    const rows = [{ rowid: 1, leaf: 1, chain: [2, 3, 4] }];
    const run = startFollowing(rows, fileOf(rows));
    run.firstRead();
    expectWhole(run, rows);
  });

  it('takes one page, and only the bytes of it the payload still needs', () => {
    const rows = [{ rowid: 1, leaf: 1, chain: [2] }];
    const run = follow(rows);
    expectWhole(run, rows);
    expect(run.whole[0].payload).toHaveLength(LOCAL_SIZE + LAST_PAGE_BYTES);
  });
});

describe('a chain in any order', () => {
  const ORDERS = permutationsOf([3, 4, 5, 6]);

  it.each(ORDERS.map((chain) => [chain]))('takes two reads with its pages on %j, read after its leaf', (chain) => {
    const rows = [{ rowid: 1, leaf: 2, chain }];
    expectWhole(follow(rows), rows);
  });

  it.each(ORDERS.map((chain) => [chain]))('takes two reads with its pages on %j, read before its leaf', (chain) => {
    const rows = [{ rowid: 1, leaf: 9, chain }];
    expectWhole(follow(rows), rows);
  });

  it('owes a row that steps backward until the second read, and hands it over only once', () => {
    const rows = [{ rowid: 1, leaf: 1, chain: [5, 4, 3, 2] }];
    const run = startFollowing(rows, fileOf(rows));
    run.firstRead();
    expect(run.chains.rowsOwed()).toBe(1);
    expect(run.whole).toEqual([]);

    run.chains.layOutRemainingPages();
    expect(run.chains.rowsOwed()).toBe(1);
    run.nextRead();
    expectWhole(run, rows);

    run.nextRead();
    expect(run.whole).toHaveLength(1);
  });

  it('keeps rows apart when their pages are shuffled together', () => {
    const rows = [
      { rowid: 1, leaf: 7, chain: [13, 2, 18, 5] },
      { rowid: 2, leaf: 3, chain: [19, 4, 12] },
      { rowid: 3, leaf: 14, chain: [11, 10, 9] },
      { rowid: 4, leaf: 1, chain: [6, 8, 15] },
    ];
    expectWhole(follow(rows), rows);
  });

  it('hands over two rows with one rowid, each with its own bytes', () => {
    const genuine = { rowid: 5, leaf: 9, chain: [3, 2] };
    const lookAlike = { rowid: 5, leaf: 1, chain: [8, 7, 6] };
    const rows = [genuine, lookAlike];
    const run = follow(rows);
    expect(run.broken).toEqual([]);
    const sorted = (payloads) => payloads.map((payload) => payload.toString('latin1')).toSorted();
    expect(sorted(run.whole.map(({ payload }) => payload))).toEqual(sorted(rows.map(payloadOf)));
  });

  it('does nothing with rows already whole when the layout comes', () => {
    const rows = [{ rowid: 1, leaf: 1, chain: [2, 3] }];
    const run = startFollowing(rows, fileOf(rows));
    run.firstRead();
    run.chains.layOutRemainingPages();
    expectWhole(run, rows);
    run.nextRead();
    expect(run.whole).toHaveLength(1);
  });
});

describe('a broken chain', () => {
  const REGIMES = [
    ['following it through a read', { rowid: 1, leaf: 1, chain: [2, 3, 4] }],
    ['laying it out', { rowid: 1, leaf: 9, chain: [4, 3, 2] }],
  ];
  const DAMAGE = [
    ['ends before its payload', ({ chain }) => [chain[0], 0]],
    ['runs on after its payload', ({ chain }) => [chain[2], 15]],
    ['points past the end of the file', ({ chain }) => [chain[0], HEADER.pageCount + 1]],
    ['loops back along itself', ({ chain }) => [chain[1], chain[0]]],
    ['points at the page it is on', ({ chain }) => [chain[0], chain[0]]],
  ];

  describe.each(REGIMES)('found by %s', (_regime, row) => {
    it.each(DAMAGE)('is given up when it %s', (_damage, damage) => {
      const pages = fileOf([row]);
      const [pageNumber, nextPage] = damage(row);
      setNextPage(pages, pageNumber, nextPage);

      const run = follow([row], pages);
      expect(run.whole).toEqual([]);
      expect(run.broken).toEqual([1]);
      expect(run.chains.rowsOwed()).toBe(0);
    });
  });

  it('leaves other rows alone', () => {
    const sound = { rowid: 1, leaf: 1, chain: [10, 8] };
    const damaged = { rowid: 2, leaf: 1, chain: [4, 3] };
    const pages = fileOf([sound, damaged]);
    setNextPage(pages, 4, 0);
    const run = follow([sound, damaged], pages);
    expect(run.broken).toEqual([2]);
    expect(run.whole.map(({ rowid }) => rowid)).toEqual([1]);
    expect(run.whole[0].payload.equals(payloadOf(sound))).toBe(true);
  });

  it('is given up as soon as a read reaches the pointer past the end of the file', () => {
    const row = { rowid: 1, leaf: 1, chain: [2, 3, 4] };
    const pages = fileOf([row]);
    setNextPage(pages, 2, HEADER.pageCount + 1);
    const run = startFollowing([row], pages);
    run.firstRead();
    expect(run.broken).toEqual([1]);
    expect(run.chains.rowsOwed()).toBe(0);
  });

  it("doesn't take a read to find, once the pointers are in", () => {
    const row = { rowid: 1, leaf: 9, chain: [4, 3, 2] };
    const pages = fileOf([row]);
    setNextPage(pages, 3, 0);
    const run = startFollowing([row], pages);
    run.firstRead();
    expect(run.chains.rowsOwed()).toBe(1);
    run.chains.layOutRemainingPages();
    expect(run.chains.rowsOwed()).toBe(0);
    expect(run.broken).toEqual([1]);
  });
});

describe('two rows claiming one page', () => {
  it('gives up on both while neither is finished', () => {
    const first = { rowid: 1, leaf: 1, chain: [2, 6, 7] };
    const second = { rowid: 2, leaf: 1, chain: [4, 6, 7] };
    const run = follow([first, second]);
    expect(run.whole).toEqual([]);
    expect(run.broken).toEqual([1, 2]);
    expect(run.chains.rowsOwed()).toBe(0);
  });

  it('takes back a row already handed over, when the other chain arrives in the same read', () => {
    const first = { rowid: 1, leaf: 1, chain: [2, 3] };
    const second = { rowid: 2, leaf: 1, chain: [5, 3] };
    const run = startFollowing([first, second], fileOf([first, second]));
    run.firstRead();
    expect(run.whole.map(({ rowid }) => rowid)).toEqual([1]);
    expect(run.broken).toEqual([1, 2]);
    expect(run.chains.rowsOwed()).toBe(0);
  });

  it('takes back a row already handed over, when the other chain is only laid out after the read', () => {
    const first = { rowid: 1, leaf: 1, chain: [2, 3] };
    const second = { rowid: 2, leaf: 9, chain: [6, 5, 3] };
    const run = startFollowing([first, second], fileOf([first, second]));
    run.firstRead();
    expect(run.whole.map(({ rowid }) => rowid)).toEqual([1]);
    expect(run.broken).toEqual([]);

    run.chains.layOutRemainingPages();
    expect(run.broken).toEqual([1, 2]);
    expect(run.chains.rowsOwed()).toBe(0);
  });

  it('gives up on a third row that lands on the same page, and reports each row once', () => {
    const rows = [
      { rowid: 1, leaf: 1, chain: [2, 8, 9] },
      { rowid: 2, leaf: 1, chain: [3, 8, 9] },
      { rowid: 3, leaf: 1, chain: [4, 8, 9] },
    ];
    const run = follow(rows);
    expect(run.whole).toEqual([]);
    expect(run.broken).toEqual([1, 2, 3]);
  });

  it('never hands over a row that has been given up', () => {
    const first = { rowid: 1, leaf: 9, chain: [8, 7, 6] };
    const second = { rowid: 2, leaf: 9, chain: [5, 7, 6] };
    const run = follow([first, second]);
    expect(run.whole).toEqual([]);
    expect(run.broken).toEqual([1, 2]);
  });

  it('stops following a row given up during a read, so the rest of its chain says nothing about other rows', () => {
    const first = { rowid: 1, leaf: 1, chain: [2, 5, 7] };
    const second = { rowid: 2, leaf: 1, chain: [3, 5, 7] };
    const sound = { rowid: 3, leaf: 1, chain: [7] };
    const run = follow([first, second, sound]);
    expect(run.broken).toEqual([1, 2]);
    expect(run.whole.map(({ rowid }) => rowid)).toEqual([3]);
  });

  it('stops laying out a row given up by another layout, so the rest of its chain says nothing either', () => {
    const first = { rowid: 1, leaf: 9, chain: [8, 7, 6] };
    const second = { rowid: 2, leaf: 9, chain: [7, 3, 4] };
    const sound = { rowid: 3, leaf: 1, chain: [3] };
    const run = follow([first, second, sound]);
    expect(run.broken.toSorted()).toEqual([1, 2]);
    expect(run.whole.map(({ rowid }) => rowid)).toEqual([3]);
  });
});

it("keeps each piece in memory of its own, so a small one can't pin a block of Node's buffer pool", () => {
  const concat = vi.spyOn(Buffer, 'concat');
  const rows = [{ rowid: 1, leaf: 5, chain: [6, 4, 3] }];
  expectWhole(follow(rows), rows);

  const [pieces] = concat.mock.calls[0];
  expect(pieces).toHaveLength(4);
  for (const piece of pieces) expect(piece.buffer.byteLength).toBe(piece.length);
});
