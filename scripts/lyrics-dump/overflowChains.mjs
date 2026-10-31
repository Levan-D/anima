/*
 * Joins spilled payloads back together from forward-only reads of a SQLite file. A chain can step back to a page that has
 * gone by, and finding that out page by page would cost a read per backward step. So the first whole read notes every
 * page's first four bytes, which are the next-page pointer on an overflow page. That lays out what's left of every chain
 * at once, and one more read collects those pages in whatever order they come.
 */
import { OVERFLOW_POINTER_BYTES } from './sqlitePages.mjs';

const FOLLOWING = 'following';
const WHOLE = 'whole';
const BROKEN = 'broken';

// Buffer.from would copy into Node's shared pool, where one small piece kept across reads pins a whole block.
function copyOutOfPool(bytes) {
  const copy = Buffer.allocUnsafeSlow(bytes.length);
  bytes.copy(copy);
  return copy;
}

/**
 * Offer it every page of a read, in file order, and start a row at each spilled cell that's wanted.
 * `onRowWhole(rowid, payload)` gets each payload once it's joined. `onRowBroken(rowid)` gets each row whose chain can't be
 * trusted, which can be a row already handed over: a chain cross-linked onto it only shows when the other chain arrives.
 */
export function createOverflowChains({ pageCount, usableSize }, { onRowWhole, onRowBroken }) {
  const bytesPerPage = usableSize - OVERFLOW_POINTER_BYTES;
  const claims = new Map();
  let nextPages = new Uint32Array(pageCount + 1);
  let rowsOwed = 0;

  const giveUp = (row) => {
    if (row.state === BROKEN) return;
    if (row.state === FOLLOWING) rowsOwed -= 1;
    row.state = BROKEN;
    row.pieces = [];
    onRowBroken(row.rowid);
  };

  // In a sound file an overflow page has one owner. With two there's no telling whose bytes it holds, so neither row
  // stands. A damaged pointer onto a page no row here claims, like an older lyrics row's, can't be seen from here at all.
  const claim = (row, pageNumber, position) => {
    const earlier = claims.get(pageNumber);
    if (earlier === undefined) {
      claims.set(pageNumber, { row, position, taken: false });
      return true;
    }
    giveUp(earlier.row);
    giveUp(row);
    return false;
  };

  /** True if the chain goes on and its next page is now claimed. The chain has to end exactly where its payload does. */
  const claimNextPage = (row, position, nextPage) => {
    const isLastPage = position === row.chainLength - 1;
    const isSound = isLastPage ? nextPage === 0 : nextPage !== 0 && nextPage <= pageCount;
    if (!isSound) {
      giveUp(row);
      return false;
    }
    return !isLastPage && claim(row, nextPage, position + 1);
  };

  const finish = (row) => {
    const payload = Buffer.concat(row.pieces);
    row.pieces = [];
    row.state = WHOLE;
    rowsOwed -= 1;
    onRowWhole(row.rowid, payload);
  };

  return {
    start(rowid, page, { localStart, localSize, payloadSize, overflowPage }) {
      const spilledBytes = payloadSize - localSize;
      const chainLength = Math.ceil(spilledBytes / bytesPerPage);
      const row = {
        rowid,
        state: FOLLOWING,
        pieces: [copyOutOfPool(page.subarray(localStart, localStart + localSize))],
        spilledBytes,
        chainLength,
        piecesOwed: chainLength,
      };
      rowsOwed += 1;
      claim(row, overflowPage, 0);
    },

    offerPage(page, pageNumber) {
      const nextPage = page.readUInt32BE(0);
      const isLaidOut = nextPages === null;
      if (!isLaidOut) nextPages[pageNumber] = nextPage;

      const claimed = claims.get(pageNumber);
      if (claimed === undefined || claimed.taken) return;
      claimed.taken = true;
      const { row, position } = claimed;
      if (row.state !== FOLLOWING) return;

      const pieceBytes = Math.min(bytesPerPage, row.spilledBytes - position * bytesPerPage);
      const pieceEnd = OVERFLOW_POINTER_BYTES + pieceBytes;
      row.pieces[position + 1] = copyOutOfPool(page.subarray(OVERFLOW_POINTER_BYTES, pieceEnd));
      row.piecesOwed -= 1;
      if (!isLaidOut) claimNextPage(row, position, nextPage);
      if (row.state === FOLLOWING && row.piecesOwed === 0) finish(row);
    },

    /** Call once, after a read that reached the end of the file. One more read then finishes every row still owed. */
    layOutRemainingPages() {
      const waiting = [...claims].filter(([, { taken }]) => !taken);
      for (const [firstPage, { row, position: firstPosition }] of waiting) {
        let pageNumber = firstPage;
        let position = firstPosition;
        while (row.state === FOLLOWING && claimNextPage(row, position, nextPages[pageNumber])) {
          pageNumber = nextPages[pageNumber];
          position += 1;
        }
      }
      nextPages = null;
    },

    rowsOwed: () => rowsOwed,
  };
}
