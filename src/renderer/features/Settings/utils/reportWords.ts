import type { ScanReport } from '@shared/domain';
import { formatCount } from '@/lib/format';

/** `5,719 added, 47 with issues`. A scan that changed nothing says how much it looked at. */
export function reportWords(report: ScanReport) {
  const { cancelled, looksEmpty, added, updated, moved, restored, nowMissing, unchanged, issues } = report;
  if (looksEmpty) return 'The folder looked empty, so nothing was marked missing';

  const parts = [
    added > 0 && `${formatCount(added)} added`,
    updated > 0 && `${formatCount(updated)} updated`,
    moved > 0 && `${formatCount(moved)} moved`,
    restored > 0 && `${formatCount(restored)} back again`,
    nowMissing > 0 && `${formatCount(nowMissing)} now missing`,
    issues > 0 && `${formatCount(issues)} with issues`,
  ].filter((part) => part !== false);

  const summary = parts.length > 0 ? parts.join(', ') : `${formatCount(unchanged)} unchanged`;
  return cancelled ? `Cancelled: ${summary}` : summary;
}
