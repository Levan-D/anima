/*
 * Which CUE sheets a scan has to read, and what they come to. A sheet is read again when it changed, or when anything
 * changed about the audio beside it. Otherwise what it said last time stands.
 */

import type { ScanIssue } from '@shared/domain';
import { errorText } from '@shared/result';
import { nameInFolder, parseCueSheet, splitOf, type CueSplit } from '@main/library/cueSheet';
import { isUnder, type FoundFile } from '@main/library/reconcile';
import { caseKey, childPath, folderOf } from '@main/library/relPath';

const MAX_SHEET_BYTES = 1024 * 1024;

export type KnownSheet = FoundFile & {
  fileId: number | null;
  issueKind: ScanIssue['kind'] | null;
  issueMessage: string | null;
};

export type SheetResult = FoundFile & {
  /** The audio it cuts up, or null when it cuts up nothing. */
  target: string | null;
  issue: ScanIssue | null;
};

type SheetInput = {
  known: KnownSheet[];
  found: FoundFile[];
  audio: FoundFile[];
  /** Case keys of the folders where some audio changed in this scan. */
  touchedFolders: ReadonlySet<string>;
  /** Case keys the walk couldn't see into: a sheet in there isn't gone. */
  unseen: ReadonlySet<string>;
  looksEmpty: boolean;
  readSheet: (relPath: string) => Promise<Uint8Array>;
  decode: (bytes: Uint8Array) => string;
};

export type SheetPlan = {
  /** By the audio file's case key. */
  splits: Map<string, { sheet: string; split: CueSplit }>;
  /** To save once the audio has been read. */
  results: Map<string, SheetResult>;
  /** Gone from the disk. */
  removed: string[];
  /** Files a sheet cut up last time and may not any more, so they have to be read again. */
  released: Set<number>;
  /** What unchanged sheets said last time, and any that couldn't be read now. */
  issues: ScanIssue[];
};

function judge(
  found: FoundFile,
  text: string,
  audio: ReadonlyMap<string, string>,
): SheetResult & { split: CueSplit | null } {
  const { relPath } = found;
  const refuse = (message: string) => ({
    ...found,
    target: null,
    split: null,
    issue: { relPath, kind: 'bad_cue' as const, message },
  });

  const parsed = parseCueSheet(text);
  if (!parsed.ok) return refuse(parsed.error.message);
  const split = splitOf(parsed.value);
  if (!split.ok) return refuse(split.error.message);
  if (split.value === null) return { ...found, target: null, split: null, issue: null };

  const name = nameInFolder(split.value.fileName);
  const target = audio.get(caseKey(childPath(folderOf(relPath), name)));
  if (target === undefined) {
    const issue = { relPath, kind: 'cue_file_missing' as const, message: `It names ${name}, which isn't beside it` };
    return { ...found, target: null, split: null, issue };
  }
  return { ...found, target, split: split.value, issue: null };
}

export async function planSheets(input: SheetInput): Promise<SheetPlan> {
  const { known, found, audio, touchedFolders, unseen, looksEmpty, readSheet, decode } = input;
  const plan: SheetPlan = { splits: new Map(), results: new Map(), removed: [], released: new Set(), issues: [] };

  const knownByPath = new Map(known.map((sheet) => [sheet.relPath, sheet]));
  const audioByKey = new Map(audio.map(({ relPath }) => [caseKey(relPath), relPath]));
  const release = (fileId: number | null | undefined) => {
    if (fileId !== null && fileId !== undefined) plan.released.add(fileId);
  };

  const foundPaths = new Set(found.map(({ relPath }) => relPath));
  for (const sheet of known) {
    if (foundPaths.has(sheet.relPath)) continue;
    if (looksEmpty || isUnder(caseKey(sheet.relPath), unseen)) continue;
    plan.removed.push(sheet.relPath);
    release(sheet.fileId);
  }

  for (const sheet of found) {
    const last = knownByPath.get(sheet.relPath);
    const isSame = last?.sizeBytes === sheet.sizeBytes && last.mtimeMs === sheet.mtimeMs;
    if (last !== undefined && isSame && !touchedFolders.has(caseKey(folderOf(sheet.relPath)))) {
      if (last.issueKind !== null && last.issueMessage !== null) {
        plan.issues.push({ relPath: sheet.relPath, kind: last.issueKind, message: last.issueMessage });
      }
      continue;
    }

    let result: ReturnType<typeof judge>;
    if (sheet.sizeBytes > MAX_SHEET_BYTES) {
      const issue = { relPath: sheet.relPath, kind: 'bad_cue' as const, message: 'It is too big to be a CUE sheet' };
      result = { ...sheet, target: null, split: null, issue };
    } else {
      try {
        result = judge(sheet, decode(await readSheet(sheet.relPath)), audioByKey);
      } catch (error) {
        // It may only be locked for a moment, so what it said last time stays.
        plan.issues.push({ relPath: sheet.relPath, kind: 'unreadable', message: errorText(error) });
        continue;
      }
    }

    release(last?.fileId);
    const { split, ...saved } = result;
    const taken = result.target === null ? undefined : plan.splits.get(caseKey(result.target));
    if (taken !== undefined) {
      const message = `${taken.sheet} already cuts up the same file`;
      plan.results.set(sheet.relPath, {
        ...saved,
        target: null,
        issue: { relPath: sheet.relPath, kind: 'bad_cue', message },
      });
    } else {
      plan.results.set(sheet.relPath, saved);
      if (split !== null && result.target !== null) {
        plan.splits.set(caseKey(result.target), { sheet: sheet.relPath, split });
      }
    }
  }

  return plan;
}
