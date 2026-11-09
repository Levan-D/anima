import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useState } from 'react';
import type { ExampleKind, MoodExample, MoodFind } from '@shared/stations';
import { AlbumArt } from '@/components/music/AlbumArt';
import { Collapse } from '@/components/ui/Collapse';
import { Pill } from '@/components/ui/Pill';
import { SearchInput } from '@/components/ui/SearchInput';
import { Text } from '@/components/ui/Text';
import { useSearchText } from '@/hooks/useSearchText';
import { formatPlural } from '@/lib/format';
import { moodSearchQuery } from '@/lib/moodQueries';
import { exampleFor } from '@/features/Radio/utils/moodDraft';
import { SayPill } from './SayPill';
import { SearchResultState } from './SearchResultState';

type Props = {
  examples: readonly MoodExample[];
  onAdd: (example: MoodExample) => void;
  onRemove: (example: MoodExample) => void;
};

const KIND_WORDS: Record<ExampleKind, string> = { track: 'Song', album: 'Album', artist: 'Artist', genre: 'Genre' };
const FINDS_SHOWN = 12;

function asideOf({ kind, by, songs }: MoodFind): string {
  if (by !== null) return `${KIND_WORDS[kind]} · ${by}`;
  if (songs !== null) return `${KIND_WORDS[kind]} · ${formatPlural(songs, 'song')}`;
  return KIND_WORDS[kind];
}

function FindRow({ find, said, onSay }: { find: MoodFind; said: boolean | null; onSay: (isYes: boolean) => void }) {
  return (
    <div className="flex h-row min-w-0 items-center gap-gap">
      <AlbumArt hash={find.artHash} title={find.label} className="size-8 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col">
        <Text truncate>{find.label}</Text>
        <Text variant="meta" color="muted" truncate>
          {asideOf(find)}
        </Text>
      </div>
      <SayPill isOn={said === true} label={`Yes, ${find.label} sounds like it`} onClick={() => onSay(true)}>
        Yes
      </SayPill>
      <SayPill isOn={said === false} isSecondary label={`No, ${find.label} doesn't`} onClick={() => onSay(false)}>
        No
      </SayPill>
    </div>
  );
}

/** Tapping one moves it to the other side; its X takes it out. */
function Chips({
  title,
  other,
  examples,
  onAdd,
  onRemove,
}: {
  title: string;
  /** Where tapping one moves it. */
  other: string;
  examples: readonly MoodExample[];
} & Pick<Props, 'onAdd' | 'onRemove'>) {
  return (
    <Collapse open={examples.length > 0}>
      <div className="flex flex-col gap-1.5 pt-1">
        <Text as="p" variant="meta" color="muted">
          {`${title} (${examples.length})`}
        </Text>
        <div className="flex flex-wrap items-center gap-1.5">
          {examples.map((example) => (
            <span key={`${example.kind}-${example.key}`} className="flex max-w-full min-w-0 items-center">
              <Pill
                isOutlined
                aria-label={`Move ${example.label} to ${other}`}
                onClick={() => onAdd({ ...example, isYes: !example.isYes })}
                className="max-w-full min-w-0 rounded-r-none border-r-0"
              >
                <Text as="span" variant="meta" color="inherit" truncate className="min-w-0">
                  {example.label}
                </Text>
                {example.source === 'listening' ? (
                  <Text as="span" variant="micro" color="inherit" className="shrink-0 opacity-70">
                    while listening
                  </Text>
                ) : null}
              </Pill>
              <Pill
                isOutlined
                aria-label={`Take ${example.label} out`}
                onClick={() => onRemove(example)}
                className="rounded-l-none px-2 [&_svg]:size-4"
              >
                <X aria-hidden />
              </Pill>
            </span>
          ))}
        </div>
      </div>
    </Collapse>
  );
}

/** What it's defined by: songs, albums, artists and genres that sound like it, and some that don't. */
export function MoodExamples({ examples, onAdd, onRemove }: Props) {
  const [query, setQuery] = useState('');
  const text = useSearchText(query);
  const isSearching = text !== '';
  const found = useQuery({ ...moodSearchQuery(text), enabled: isSearching });
  const finds = (found.data ?? []).slice(0, FINDS_SHOWN);

  return (
    <div className="flex flex-col gap-gap">
      <Text as="p" variant="meta" color="muted">
        Say yes to what sounds like it, and no to what comes close but doesn&apos;t belong. A few albums or artists of
        each is a good start. Tap one below to move it to the other side
      </Text>
      <SearchInput
        value={query}
        onValueChange={setQuery}
        label="Search for songs, albums, artists or genres"
        placeholder="Songs, albums, artists or genres"
      />
      <Collapse open={isSearching}>
        <div className="max-h-[calc(var(--spacing-row)*6)] overflow-x-hidden overflow-y-auto">
          <SearchResultState
            isLoading={found.isPending}
            isEmpty={finds.length === 0}
            emptyWords="Nothing matches. Try fewer words"
            error={found.error}
            onRetry={() => void found.refetch()}
          >
            {finds.map((find) => (
              <FindRow
                key={`${find.kind}-${find.key}`}
                find={find}
                said={exampleFor(examples, find.kind, find.key)?.isYes ?? null}
                onSay={(isYes) => onAdd({ kind: find.kind, key: find.key, label: find.label, isYes, source: 'picked' })}
              />
            ))}
          </SearchResultState>
        </div>
      </Collapse>
      <Chips
        title="Sounds like it"
        other="doesn't belong"
        examples={examples.filter(({ isYes }) => isYes)}
        onAdd={onAdd}
        onRemove={onRemove}
      />
      <Chips
        title="Doesn't belong"
        other="sounds like it"
        examples={examples.filter(({ isYes }) => !isYes)}
        onAdd={onAdd}
        onRemove={onRemove}
      />
    </div>
  );
}
