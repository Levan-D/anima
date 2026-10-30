import { describe, expect, it } from 'vitest';
import {
  canAnythingHaveMoved,
  matchMoved,
  planRescan,
  type FoundFile,
  type HashedFile,
  type KnownFile,
} from '@main/library/reconcile';

function known(id: number, relPath: string, overrides: Partial<KnownFile> = {}): KnownFile {
  return { id, relPath, sizeBytes: 100, mtimeMs: 1000, audioHash: `hash-${id}`, missingSince: null, ...overrides };
}

function found(relPath: string, overrides: Partial<FoundFile> = {}): FoundFile {
  return { relPath, sizeBytes: 100, mtimeMs: 1000, ...overrides };
}

function hashed(relPath: string, audioHash: string | null): HashedFile {
  return { ...found(relPath), audioHash };
}

const ids = (files: { id: number }[]) => files.map(({ id }) => id);
const matchedIds = (files: { known: { id: number } }[]) => files.map(({ known: file }) => file.id);

describe('planRescan', () => {
  it('leaves a file with the same path, size and mtime alone', () => {
    const plan = planRescan([known(1, 'a.flac')], [found('a.flac')], []);
    expect(matchedIds(plan.unchanged)).toEqual([1]);
    expect(plan.changed).toEqual([]);
    expect(plan.added).toEqual([]);
    expect(plan.gone).toEqual([]);
  });

  it('calls it restored when an unchanged file had been marked missing', () => {
    const plan = planRescan([known(1, 'a.flac', { missingSince: 5 })], [found('a.flac')], []);
    expect(matchedIds(plan.restored)).toEqual([1]);
    expect(plan.unchanged).toEqual([]);
  });

  it('calls it changed when the size differs, keeping the id', () => {
    const plan = planRescan([known(1, 'a.flac')], [found('a.flac', { sizeBytes: 101 })], []);
    expect(matchedIds(plan.changed)).toEqual([1]);
    expect(plan.changed[0]?.found.sizeBytes).toBe(101);
  });

  it('calls it changed when the mtime differs', () => {
    const plan = planRescan([known(1, 'a.flac')], [found('a.flac', { mtimeMs: 2000 })], []);
    expect(matchedIds(plan.changed)).toEqual([1]);
  });

  it('still calls it changed when a changed file comes back from missing', () => {
    const plan = planRescan([known(1, 'a.flac', { missingSince: 5 })], [found('a.flac', { mtimeMs: 2000 })], []);
    expect(matchedIds(plan.changed)).toEqual([1]);
    expect(plan.restored).toEqual([]);
  });

  it('adds a new path', () => {
    const plan = planRescan([], [found('new.flac')], []);
    expect(plan.added).toEqual([found('new.flac')]);
  });

  it('sees a row whose path was not found as gone', () => {
    const plan = planRescan([known(1, 'a.flac'), known(2, 'b.flac')], [found('a.flac')], []);
    expect(ids(plan.gone)).toEqual([2]);
    expect(plan.protectedCount).toBe(0);
  });

  it('keeps a row that was already missing in gone, so a later file can still match it', () => {
    const plan = planRescan([known(1, 'a.flac'), known(2, 'b.flac', { missingSince: 5 })], [found('a.flac')], []);
    expect(ids(plan.gone)).toEqual([2]);
  });

  describe('case', () => {
    it('matches a case-only rename to the same row, reporting the new spelling', () => {
      const plan = planRescan([known(1, 'Artist/Song.FLAC')], [found('artist/song.flac')], []);
      expect(plan.added).toEqual([]);
      expect(plan.gone).toEqual([]);
      expect(matchedIds(plan.unchanged)).toEqual([1]);
      expect(plan.unchanged[0]?.found.relPath).toBe('artist/song.flac');
      expect(plan.unchanged[0]?.known.relPath).toBe('Artist/Song.FLAC');
    });

    it('matches a case-only rename that also changed the file', () => {
      const plan = planRescan([known(1, 'A.flac')], [found('a.flac', { sizeBytes: 5 })], []);
      expect(matchedIds(plan.changed)).toEqual([1]);
      expect(plan.changed[0]?.found.relPath).toBe('a.flac');
    });

    it('prefers the exact path when a case-sensitive folder holds both spellings', () => {
      const plan = planRescan([known(1, 'a.flac'), known(2, 'A.flac')], [found('A.flac'), found('a.flac')], []);
      expect(plan.unchanged.map(({ known: file, found: seen }) => [file.id, seen.relPath])).toEqual(
        expect.arrayContaining([
          [1, 'a.flac'],
          [2, 'A.flac'],
        ]),
      );
      expect(plan.added).toEqual([]);
      expect(plan.gone).toEqual([]);
    });

    it('adds the second spelling as its own file when only one row exists', () => {
      const plan = planRescan([known(1, 'a.flac')], [found('A.flac'), found('a.flac')], []);
      expect(matchedIds(plan.unchanged)).toEqual([1]);
      expect(plan.added.map(({ relPath }) => relPath)).toEqual(['A.flac']);
    });
  });

  describe('guards', () => {
    it('protects everything under a folder that could not be read', () => {
      const plan = planRescan(
        [known(1, 'Locked/a.flac'), known(2, 'Locked/Deep/b.flac'), known(3, 'Open/c.flac')],
        [found('Open/other.flac')],
        ['Locked'],
      );
      expect(plan.protectedCount).toBe(2);
      expect(ids(plan.gone)).toEqual([3]);
    });

    it('matches an unreadable folder regardless of case', () => {
      const plan = planRescan(
        [known(1, 'LOCKED/a.flac'), known(2, 'Other/b.flac')],
        [found('Other/b.flac')],
        ['locked'],
      );
      expect(plan.protectedCount).toBe(1);
      expect(plan.gone).toEqual([]);
    });

    it('does not protect a neighbor whose name only starts the same', () => {
      const plan = planRescan([known(1, 'Locked2/a.flac')], [found('other.flac')], ['Locked']);
      expect(ids(plan.gone)).toEqual([1]);
    });

    it('protects a single file that could not be read', () => {
      const plan = planRescan([known(1, 'a.flac'), known(2, 'b.flac')], [found('b.flac')], ['a.flac']);
      expect(plan.protectedCount).toBe(1);
      expect(plan.gone).toEqual([]);
    });

    it('marks nothing gone when nothing was found and the database has files', () => {
      const plan = planRescan([known(1, 'a.flac'), known(2, 'b.flac')], [], []);
      expect(plan.looksEmpty).toBe(true);
      expect(plan.gone).toEqual([]);
      expect(plan.protectedCount).toBe(2);
    });

    it('is not suspicious of an empty folder with an empty database', () => {
      expect(planRescan([], [], []).looksEmpty).toBe(false);
    });
  });

  it('handles everything at once', () => {
    const plan = planRescan(
      [
        known(1, 'same.flac'),
        known(2, 'tagged.flac'),
        known(3, 'deleted.flac'),
        known(4, 'back.flac', { missingSince: 9 }),
        known(5, 'Locked/kept.flac'),
      ],
      [found('same.flac'), found('tagged.flac', { mtimeMs: 7 }), found('new.flac'), found('back.flac')],
      ['Locked'],
    );
    expect(matchedIds(plan.unchanged)).toEqual([1]);
    expect(matchedIds(plan.changed)).toEqual([2]);
    expect(matchedIds(plan.restored)).toEqual([4]);
    expect(plan.added.map(({ relPath }) => relPath)).toEqual(['new.flac']);
    expect(ids(plan.gone)).toEqual([3]);
    expect(plan.protectedCount).toBe(1);
  });
});

describe('matchMoved', () => {
  it('turns a new file with the hash of one gone row into a move', () => {
    const plan = matchMoved([known(1, 'old.flac', { audioHash: 'x' })], [hashed('new.flac', 'x')]);
    expect(plan.moves.map(({ known: file, found: seen }) => [file.id, seen.relPath])).toEqual([[1, 'new.flac']]);
    expect(plan.added).toEqual([]);
    expect(plan.gone).toEqual([]);
  });

  it('leaves unrelated files alone', () => {
    const plan = matchMoved([known(1, 'old.flac', { audioHash: 'x' })], [hashed('new.flac', 'y')]);
    expect(plan.moves).toEqual([]);
    expect(plan.added.map(({ relPath }) => relPath)).toEqual(['new.flac']);
    expect(ids(plan.gone)).toEqual([1]);
  });

  it('never matches two gone rows with the same hash', () => {
    const plan = matchMoved(
      [known(1, 'a.flac', { audioHash: 'x' }), known(2, 'b.flac', { audioHash: 'x' })],
      [hashed('new.flac', 'x')],
    );
    expect(plan.moves).toEqual([]);
    expect(plan.added).toHaveLength(1);
    expect(ids(plan.gone)).toEqual([1, 2]);
  });

  it('gives a gone row to the first new file in sorted order, and adds the rest', () => {
    const plan = matchMoved(
      [known(1, 'old.flac', { audioHash: 'x' })],
      [hashed('z.flac', 'x'), hashed('a.flac', 'x'), hashed('M.flac', 'x')],
    );
    expect(plan.moves.map(({ found: seen }) => seen.relPath)).toEqual(['a.flac']);
    expect(plan.added.map(({ relPath }) => relPath)).toEqual(['M.flac', 'z.flac']);
    expect(plan.gone).toEqual([]);
  });

  it('never matches a file with no hash', () => {
    const plan = matchMoved([known(1, 'old.flac', { audioHash: null })], [hashed('new.flac', null)]);
    expect(plan.moves).toEqual([]);
    expect(plan.added).toHaveLength(1);
    expect(plan.gone).toHaveLength(1);
  });

  it('can match a row that went missing in an earlier scan', () => {
    const plan = matchMoved([known(1, 'old.flac', { audioHash: 'x', missingSince: 5 })], [hashed('new.flac', 'x')]);
    expect(matchedIds(plan.moves)).toEqual([1]);
  });

  it('does several moves at once', () => {
    const plan = matchMoved(
      [
        known(1, 'a.flac', { audioHash: 'x' }),
        known(2, 'b.flac', { audioHash: 'y' }),
        known(3, 'c.flac', { audioHash: 'z' }),
      ],
      [hashed('new/a.flac', 'x'), hashed('new/b.flac', 'y'), hashed('other.flac', 'q')],
    );
    expect(matchedIds(plan.moves)).toEqual([1, 2]);
    expect(plan.added.map(({ relPath }) => relPath)).toEqual(['other.flac']);
    expect(ids(plan.gone)).toEqual([3]);
  });

  describe('when a path already on record has changed', () => {
    const pair = (id: number, relPath: string, was: string | null, now: string | null) => ({
      known: known(id, relPath, { audioHash: was }),
      found: hashed(relPath, now),
    });
    const moved = (plan: ReturnType<typeof matchMoved>) =>
      plan.moves.map(({ known: file, found: seen }) => [file.id, seen.relPath]);

    it('leaves a retag alone: the same audio is still the same recording', () => {
      const plan = matchMoved([], [], [pair(1, 'a.flac', 'x', 'x')]);
      expect(plan.moves).toEqual([]);
      expect(matchedIds(plan.changed)).toEqual([1]);
    });

    it('follows the audio when two files swap names', () => {
      const plan = matchMoved([], [], [pair(1, 'a.flac', 'x', 'y'), pair(2, 'b.flac', 'y', 'x')]);
      expect(moved(plan)).toEqual([
        [2, 'a.flac'],
        [1, 'b.flac'],
      ]);
      expect(plan.changed).toEqual([]);
      expect(plan.gone).toEqual([]);
      expect(plan.displaced).toEqual([]);
    });

    it('follows the audio around a ring of three', () => {
      const plan = matchMoved(
        [],
        [],
        [pair(1, 'a.flac', 'x', 'z'), pair(2, 'b.flac', 'y', 'x'), pair(3, 'c.flac', 'z', 'y')],
      );
      expect(moved(plan)).toEqual([
        [3, 'a.flac'],
        [1, 'b.flac'],
        [2, 'c.flac'],
      ]);
    });

    it('a file moved onto a path that had gone takes its own id there, and the id it replaced goes missing', () => {
      const plan = matchMoved([known(2, 'two.flac', { audioHash: 'y' })], [], [pair(1, 'one.flac', 'x', 'y')]);
      expect(moved(plan)).toEqual([[2, 'one.flac']]);
      expect(ids(plan.gone)).toEqual([1]);
      expect(ids(plan.displaced)).toEqual([1]);
      expect(plan.changed).toEqual([]);
    });

    it('new audio that matches nothing keeps the id at that path, as a replaced file always has', () => {
      const plan = matchMoved([known(2, 'two.flac', { audioHash: 'y' })], [], [pair(1, 'one.flac', 'x', 'z')]);
      expect(plan.moves).toEqual([]);
      expect(matchedIds(plan.changed)).toEqual([1]);
      expect(ids(plan.gone)).toEqual([2]);
    });

    it('when a row leaves for a new path, what replaced it there is a new file', () => {
      const plan = matchMoved([], [hashed('new/one.flac', 'x')], [pair(1, 'one.flac', 'x', 'z')]);
      expect(moved(plan)).toEqual([[1, 'new/one.flac']]);
      expect(plan.added.map(({ relPath }) => relPath)).toEqual(['one.flac']);
      expect(plan.changed).toEqual([]);
      expect(plan.gone).toEqual([]);
    });

    it('never matches audio that two rows could claim', () => {
      const plan = matchMoved(
        [known(2, 'two.flac', { audioHash: 'y' }), known(3, 'three.flac', { audioHash: 'y' })],
        [],
        [pair(1, 'one.flac', 'x', 'y')],
      );
      expect(plan.moves).toEqual([]);
      expect(matchedIds(plan.changed)).toEqual([1]);
    });

    it('has nothing to go on with no hash on either side', () => {
      expect(matchedIds(matchMoved([], [], [pair(1, 'a.flac', null, 'y')]).changed)).toEqual([1]);
      expect(matchedIds(matchMoved([], [], [pair(1, 'a.flac', 'x', null)]).changed)).toEqual([1]);
    });
  });
});

describe('canAnythingHaveMoved', () => {
  const changed = { known: known(1, 'a.flac'), found: found('a.flac') };

  it('needs a row that lost its audio and a file with no row', () => {
    expect(canAnythingHaveMoved({ gone: [known(1, 'a')], added: [found('b')], changed: [] })).toBe(true);
    expect(canAnythingHaveMoved({ gone: [known(1, 'a')], added: [], changed: [] })).toBe(false);
    expect(canAnythingHaveMoved({ gone: [], added: [found('b')], changed: [] })).toBe(false);
  });

  it('one changed file alone has nothing to swap with, so a single retag costs no hashing', () => {
    expect(canAnythingHaveMoved({ gone: [], added: [], changed: [changed] })).toBe(false);
  });

  it('two changed files could have swapped, and a changed file could be where a gone row went', () => {
    expect(canAnythingHaveMoved({ gone: [], added: [], changed: [changed, changed] })).toBe(true);
    expect(canAnythingHaveMoved({ gone: [known(2, 'b')], added: [], changed: [changed] })).toBe(true);
    expect(canAnythingHaveMoved({ gone: [], added: [found('b')], changed: [changed] })).toBe(true);
  });
});
