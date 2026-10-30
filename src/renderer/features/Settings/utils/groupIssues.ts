import type { ScanIssue } from '@shared/domain';

type IssueGroup = {
  kind: ScanIssue['kind'];
  message: string;
  count: number;
};

/** In the order each reason first comes up. */
export function groupIssues(issues: ScanIssue[]): IssueGroup[] {
  const groups = new Map<string, IssueGroup>();
  for (const { kind, message } of issues) {
    const key = `${kind}:${message}`;
    const group = groups.get(key);
    if (group) group.count++;
    else groups.set(key, { kind, message, count: 1 });
  }
  return [...groups.values()];
}
