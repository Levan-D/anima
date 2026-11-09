import type { UseQueryResult } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import {
  MOOD_FEW_SONGS,
  type MoodExample,
  type MoodGrade,
  type MoodRule,
  type MoodRuleState,
  type MoodTry,
} from '@shared/stations';
import { Button } from '@/components/ui/Button';
import { DropdownMenu } from '@/components/ui/DropdownMenu';
import type { MenuEntry } from '@/components/ui/menuEntries';
import { Pill } from '@/components/ui/Pill';
import { ProgressLine } from '@/components/ui/ProgressLine';
import { Text } from '@/components/ui/Text';
import { cn } from '@/lib/cn';
import { formatCount, formatPlural } from '@/lib/format';
import type { MoodGrading } from '@/features/Radio/hooks/useMoodGrade';
import type { TunerDraft } from '@/features/Radio/utils/moodDraft';

type Props = {
  draft: TunerDraft;
  tried: UseQueryResult<MoodTry>;
  canTry: boolean;
  grading: MoodGrading;
  onRule: (rule: MoodRule, isOn: boolean) => void;
  onGenre: (genre: string | null) => void;
  onDecade: (decade: number | null) => void;
};

type Tried = Extract<MoodTry, { problem: null }>;

const RULES: { rule: MoodRule; label: string; missing: string }[] = [
  { rule: 'instrumental', label: 'Instrumental', missing: 'the voice model' },
  { rule: 'calm', label: 'Calm', missing: 'the energy models' },
  { rule: 'littleSinging', label: 'Little singing', missing: 'lyrics for some songs' },
];

function labelOf(examples: readonly MoodExample[], index: number): string {
  return examples[index]?.label ?? 'an example';
}

function GradeWords({ grade, examples }: { grade: MoodGrade; examples: readonly MoodExample[] }) {
  if (grade.kind === 'too-few') {
    return (
      <Text as="p" variant="meta" color="muted">
        To check itself it needs two albums, artists or genres that sound like it
      </Text>
    );
  }
  if (grade.kind === 'clear') {
    return (
      <Text as="p" variant="meta">
        Clear. Each album, artist and genre it was given lands where it should when it&apos;s hidden from it
      </Text>
    );
  }
  const astray = grade.examples.filter(({ isRight }) => !isRight).map(({ index }) => labelOf(examples, index));
  return (
    <div className="flex flex-col gap-1">
      <Text as="p" variant="meta">
        {`Fuzzy. Hidden from it, ${astray.join(', ')} ${astray.length === 1 ? 'lands' : 'land'} on the wrong side`}
      </Text>
      {grade.alike.map(({ yes, no }) => (
        <Text key={`${yes}-${no}`} as="p" variant="meta" color="muted">
          {`${labelOf(examples, yes)} and ${labelOf(examples, no)} sound alike to it`}
        </Text>
      ))}
      <Text as="p" variant="meta" color="muted">
        Marking single songs, or another check round, can draw the line. Some lines it can&apos;t hear
      </Text>
    </div>
  );
}

function Grade({
  grading,
  known,
  examples,
}: {
  grading: MoodGrading;
  known: MoodGrade | null;
  examples: readonly MoodExample[];
}) {
  const { state, start } = grading;
  const grade = state?.phase === 'done' ? state.grade : known;
  const isGrading = state?.phase === 'grading';
  const progress = isGrading && state.total > 0 ? state.done / state.total : null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-gap">
        <Button variant="outline" size="sm" loading={isGrading} onClick={start}>
          {grade === null ? 'Check how clear it is' : 'Check again'}
        </Button>
        <Text variant="meta" color="muted" tabular>
          {isGrading && state.total > 0 ? `Hiding each example in turn: ${state.done} of ${state.total}` : ''}
        </Text>
      </div>
      {isGrading ? <ProgressLine value={progress} label="Checking how clear it is" /> : null}
      {state?.phase === 'failed' ? (
        <Text as="p" variant="meta" color="danger" role="alert">
          {state.message}
        </Text>
      ) : null}
      {grade === null || isGrading ? null : (
        <div className="content-in">
          <GradeWords grade={grade} examples={examples} />
        </div>
      )}
    </div>
  );
}

function Rules({
  draft,
  states,
  onRule,
}: {
  draft: TunerDraft;
  states: Tried['rules'] | null;
  onRule: Props['onRule'];
}) {
  const missing = RULES.filter(({ rule }) => states?.[rule] === 'unavailable');
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1.5">
        {RULES.map(({ rule, label }) => {
          const state: MoodRuleState = states?.[rule] ?? 'ready';
          const isOn = draft.rules[rule] && state === 'ready';
          return (
            <Pill
              key={rule}
              isOutlined
              data-state={isOn ? 'on' : 'off'}
              aria-pressed={isOn}
              disabled={state === 'unavailable'}
              onClick={() => onRule(rule, !draft.rules[rule])}
            >
              {label}
            </Pill>
          );
        })}
      </div>
      <Text as="p" variant="meta" color="muted">
        Each keeps it to what the songs that sound like it have in common: as instrumental, as calm, as little sung
      </Text>
      {missing.length === 0 ? null : (
        <Text as="p" variant="meta" color="muted">
          {`${missing.map(({ label }) => label).join(' and ')} ${missing.length === 1 ? 'needs' : 'need'} ${missing
            .map(({ missing: what }) => what)
            .join(' and ')}`}
        </Text>
      )}
    </div>
  );
}

function Filter({
  label,
  chosen,
  entries,
  songs,
}: {
  label: string;
  chosen: string;
  entries: MenuEntry[];
  songs: number | null;
}) {
  const isFew = songs !== null && songs < MOOD_FEW_SONGS;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <DropdownMenu entries={entries} searchLabel={`Search ${label.toLowerCase()}s`} align="start">
        <Button variant="outline" size="sm" aria-label={`${label}: ${chosen}`} className="max-w-80 [&>span]:min-w-0">
          <span className="min-w-0 truncate">{chosen}</span>
          <ChevronDown aria-hidden />
        </Button>
      </DropdownMenu>
      {isFew ? (
        <Text as="p" variant="meta" color="danger">
          {`Only ${formatPlural(songs, 'song')} with this. It will repeat itself soon`}
        </Text>
      ) : null}
    </div>
  );
}

function Filters({
  draft,
  tried,
  onGenre,
  onDecade,
}: { draft: TunerDraft; tried: Tried | null } & Pick<Props, 'onGenre' | 'onDecade'>) {
  const genres = tried?.genres ?? [];
  const decades = tried?.decades ?? [];
  const genreEntries: MenuEntry[] = [
    { kind: 'item', label: 'Any genre', isCurrent: draft.genre === null, onSelect: () => onGenre(null) },
    ...genres.map(({ name, songs }): MenuEntry => ({
      kind: 'item',
      label: `${name} · ${formatCount(songs)}`,
      isCurrent: draft.genre === name,
      onSelect: () => onGenre(name),
    })),
  ];
  const decadeEntries: MenuEntry[] = [
    { kind: 'item', label: 'Any decade', isCurrent: draft.decade === null, onSelect: () => onDecade(null) },
    ...decades.map(({ decade, songs }): MenuEntry => ({
      kind: 'item',
      label: `${decade}s · ${formatCount(songs)}`,
      isCurrent: draft.decade === decade,
      onSelect: () => onDecade(decade),
    })),
  ];
  const filtered = tried === null || (draft.genre === null && draft.decade === null) ? null : tried.songs;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-start gap-gap">
        <Filter
          label="Genre"
          chosen={draft.genre ?? 'Any genre'}
          entries={genreEntries}
          songs={draft.genre === null ? null : filtered}
        />
        <Filter
          label="Decade"
          chosen={draft.decade === null ? 'Any decade' : `${draft.decade}s`}
          entries={decadeEntries}
          songs={draft.decade === null ? null : filtered}
        />
      </div>
      <Text as="p" variant="meta" color="muted">
        Keeps it to one genre or decade. Each says how many songs it would leave
      </Text>
    </div>
  );
}

/** How big it is, how sure, and what it keeps to. */
export function MoodPlays({ draft, tried, canTry, grading, onRule, onGenre, onDecade }: Props) {
  const answer = tried.data?.problem === null ? tried.data : null;
  const isWorking = canTry && tried.isFetching;

  let size = 'Add something that sounds like it to see what it plays';
  if (answer !== null) size = `Plays ${formatPlural(answer.songs, 'song')}`;
  else if (isWorking) size = 'Working out what it plays';

  return (
    <div className="flex flex-col gap-section">
      <div className="flex flex-col gap-1">
        <Text
          as="p"
          variant="lead"
          tabular
          className={cn('transition-opacity duration-(--dur-quick)', isWorking && 'opacity-60')}
        >
          {size}
        </Text>
        <ProgressLine value={isWorking ? null : 1} label="Working it out" className={cn(!isWorking && 'opacity-0')} />
      </div>
      {answer === null ? null : <Grade grading={grading} known={answer.grade} examples={draft.examples} />}
      <Rules draft={draft} states={answer?.rules ?? null} onRule={onRule} />
      <Filters draft={draft} tried={answer} onGenre={onGenre} onDecade={onDecade} />
    </div>
  );
}
