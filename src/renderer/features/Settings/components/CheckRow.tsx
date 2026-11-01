import { Check, ChevronRight } from 'lucide-react';
import type { ReportCheck } from '@shared/domain';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { formatCount } from '@/lib/format';
import { openReportCheck, openSettings } from '@/lib/pages';

type WordsProps = {
  check: ReportCheck;
};

function Words({ check: { name, description } }: WordsProps) {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <Text>{name}</Text>
      <Text variant="meta" color="muted">
        {description}
      </Text>
    </span>
  );
}

type Props = {
  check: ReportCheck;
};

/** Nothing to open with nothing in it, so it's a calm line rather than a button. */
function QuietRow({ check }: Props) {
  const { isChecking, isInfo } = check;
  const noneWord = isInfo ? 'None' : 'All good';

  return (
    <div className="flex min-h-row items-center gap-gap px-gutter py-2">
      <Words check={check} />
      {isChecking || isInfo ? null : <Check aria-hidden className="size-4 shrink-0 text-text-faint" />}
      <Text variant="meta" color="muted" className="shrink-0">
        {isChecking ? 'Checking' : noneWord}
      </Text>
    </div>
  );
}

export function CheckRow({ check }: Props) {
  const { id, name, count, isChecking, opensData } = check;
  if (isChecking || count === 0) return <QuietRow check={check} />;

  return (
    <div className="flex items-center">
      <Button
        variant="row"
        size="row"
        aria-label={`${name}: ${formatCount(count)}`}
        onClick={() => openReportCheck(id)}
        className="h-auto min-h-row w-auto min-w-0 flex-1 shrink py-2"
      >
        <Words check={check} />
        <Text tabular className="shrink-0">
          {formatCount(count)}
        </Text>
        <ChevronRight aria-hidden className="text-text-faint" />
      </Button>
      {opensData ? (
        <Button
          variant="outline"
          size="sm"
          aria-label={`Open Data for ${name}`}
          onClick={() => openSettings('data')}
          className="mr-gutter"
        >
          Open Data
        </Button>
      ) : null}
    </div>
  );
}
