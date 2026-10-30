/* What a rescan has to do, decided from data alone: the file rows on record against what the walk found. */

import { byRelPath, caseKey } from '@main/library/relPath';

export type KnownFile = {
  id: number;
  relPath: string;
  sizeBytes: number;
  mtimeMs: number;
  audioHash: string | null;
  missingSince: number | null;
};

export type FoundFile = {
  relPath: string;
  sizeBytes: number;
  mtimeMs: number;
};

export type HashedFile = FoundFile & { audioHash: string | null };

export type MatchedFile = {
  known: KnownFile;
  found: FoundFile;
};

type RescanPlan = {
  /** The same size and mtime. `found.relPath` differs from `known.relPath` after a case-only rename. */
  unchanged: MatchedFile[];
  /** As unchanged, and they had been marked missing. */
  restored: MatchedFile[];
  /** A different size or mtime: read again, keeping the id unless it turns out to be another row's audio. */
  changed: MatchedFile[];
  added: FoundFile[];
  gone: KnownFile[];
  /** Not found, but the walk couldn't look where they'd be, or the whole folder looks empty. */
  protectedCount: number;
  /** Nothing found while the database has files, which says more about the folder than about the files. */
  looksEmpty: boolean;
};

/** Whether a path is one of these, or inside one of them. They're all case keys. */
export function isUnder(key: string, unreadable: ReadonlySet<string>): boolean {
  if (unreadable.size === 0) return false;
  let path = key;
  for (;;) {
    if (unreadable.has(path)) return true;
    const slash = path.lastIndexOf('/');
    if (slash === -1) return false;
    path = path.slice(0, slash);
  }
}

export function planRescan(known: KnownFile[], found: FoundFile[], unreadablePaths: string[]): RescanPlan {
  const plan: RescanPlan = {
    unchanged: [],
    restored: [],
    changed: [],
    added: [],
    gone: [],
    protectedCount: 0,
    looksEmpty: found.length === 0 && known.length > 0,
  };

  const exact = new Map(known.map((file) => [file.relPath, file]));
  const byKey = new Map<string, KnownFile[]>();
  for (const file of known) {
    const key = caseKey(file.relPath);
    byKey.set(key, [...(byKey.get(key) ?? []), file]);
  }
  const claimed = new Set<number>();

  const claim = (file: FoundFile, match: KnownFile): void => {
    claimed.add(match.id);
    const pair = { known: match, found: file };
    if (match.sizeBytes !== file.sizeBytes || match.mtimeMs !== file.mtimeMs) plan.changed.push(pair);
    else if (match.missingSince === null) plan.unchanged.push(pair);
    else plan.restored.push(pair);
  };

  // Exact paths first: a folder set to case-sensitive can hold two files that differ only by case.
  const sorted = found.toSorted(byRelPath);
  const unmatched: FoundFile[] = [];
  for (const file of sorted) {
    const match = exact.get(file.relPath);
    if (match) claim(file, match);
    else unmatched.push(file);
  }

  for (const file of unmatched) {
    const match = byKey.get(caseKey(file.relPath))?.find(({ id }) => !claimed.has(id));
    if (match) claim(file, match);
    else plan.added.push(file);
  }

  const unreadable = new Set(unreadablePaths.map(caseKey));
  for (const file of known) {
    if (claimed.has(file.id)) continue;
    if (plan.looksEmpty || isUnder(caseKey(file.relPath), unreadable)) plan.protectedCount++;
    else plan.gone.push(file);
  }

  return plan;
}

/** A swap can only be found by hashing what changed, and one changed file alone has nothing to swap with. */
export function canAnythingHaveMoved({
  gone,
  added,
  changed,
}: Pick<RescanPlan, 'gone' | 'added' | 'changed'>): boolean {
  const rowsThatLostAudio = gone.length + changed.length;
  const filesNeedingARow = added.length + changed.length;
  return rowsThatLostAudio > 0 && filesNeedingARow > 0 && gone.length + added.length + changed.length > 1;
}

export type Move = {
  known: KnownFile;
  found: HashedFile;
};

type HashedMatch = {
  known: KnownFile;
  found: HashedFile;
};

type MovePlan = {
  moves: Move[];
  added: HashedFile[];
  gone: KnownFile[];
  /** Still the same recording, or new audio that isn't any other row's: it keeps its id. */
  changed: HashedMatch[];
  /** In `gone` as well: another row's audio arrived at their path, so they need to let go of it. */
  displaced: KnownFile[];
};

/**
 * A new file is a move only when its hash points at exactly one row that lost its audio. Two such rows with the same
 * hash could each be it, so neither is matched. Several new files for one row: the first in sorted order is the move,
 * and the rest are added. A changed file counts as new when its audio isn't its row's any more, which is how a swap,
 * or a file moved onto a path that had gone, keeps each id with its recording.
 */
export function matchMoved(gone: KnownFile[], added: HashedFile[], changed: HashedMatch[] = []): MovePlan {
  const isReplaced = ({ known, found }: HashedMatch) =>
    known.audioHash !== null && found.audioHash !== null && known.audioHash !== found.audioHash;
  const replaced = changed.filter(isReplaced);

  const candidates = new Map<string, KnownFile[]>();
  for (const file of [...gone, ...replaced.map(({ known }) => known)]) {
    if (file.audioHash === null) continue;
    candidates.set(file.audioHash, [...(candidates.get(file.audioHash) ?? []), file]);
  }

  const moved = new Set<number>();
  const movedFiles = new Set<string>();
  const moves: Move[] = [];
  for (const file of [...added, ...replaced.map(({ found }) => found)].toSorted(byRelPath)) {
    const matches = file.audioHash === null ? undefined : candidates.get(file.audioHash);
    const match = matches?.length === 1 ? matches[0] : undefined;
    if (match && !moved.has(match.id)) {
      moved.add(match.id);
      movedFiles.add(file.relPath);
      moves.push({ known: match, found: file });
    }
  }

  const displaced = replaced
    .filter(({ known, found }) => movedFiles.has(found.relPath) && !moved.has(known.id))
    .map(({ known }) => known);
  // A row that moved away leaves a file with no row, and one that stayed keeps the file it's got.
  const orphaned = replaced
    .filter(({ known, found }) => !movedFiles.has(found.relPath) && moved.has(known.id))
    .map(({ found }) => found);

  return {
    moves,
    added: [...added.filter(({ relPath }) => !movedFiles.has(relPath)), ...orphaned].toSorted(byRelPath),
    gone: [...gone.filter(({ id }) => !moved.has(id)), ...displaced],
    changed: changed.filter(
      (pair) => !isReplaced(pair) || !(movedFiles.has(pair.found.relPath) || moved.has(pair.known.id)),
    ),
    displaced,
  };
}
