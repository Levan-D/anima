import { useQuery } from '@tanstack/react-query';
import { Check, Plus, X } from 'lucide-react';
import { useRef, useState, type FormEvent, type SyntheticEvent } from 'react';
import type { Track } from '@shared/domain';
import type { Result } from '@shared/result';
import { AlbumArt } from '@/components/music/AlbumArt';
import { Button } from '@/components/ui/Button';
import { Divider } from '@/components/ui/Divider';
import { DragHandle, DragReorder } from '@/components/ui/DragReorder';
import { ErrorState } from '@/components/ui/ErrorState';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { SearchInput } from '@/components/ui/SearchInput';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useSearchText } from '@/hooks/useSearchText';
import { useTimeoutWhile } from '@/hooks/useTimeoutWhile';
import { formatPlural } from '@/lib/format';
import { searchQuery, tracksQuery } from '@/lib/libraryQueries';
import { useMotionDuration } from '@/lib/motionTokens';

const RESULTS = 30;

export type PlaylistEdit = { name: string; trackIds: number[] };

type Props = {
  title: string;
  submitLabel: string;
  initialName?: string;
  /** What's in it already, picked from the start: taking one out takes it out of the playlist. */
  initialTracks?: readonly Track[];
  /** Stays open with what went wrong, such as a name that's taken, unless this says it worked. */
  onSubmit: (edit: PlaylistEdit) => Promise<Result<unknown>>;
  onClose: () => void;
};

function TrackLine({ track }: { track: Track }) {
  return (
    <>
      <AlbumArt hash={track.artHash} title={track.album ?? track.title} className="size-8 shrink-0" />
      <Text truncate className="min-w-0 flex-1">
        {track.title}
      </Text>
      <Text variant="meta" color="muted" truncate className="max-w-2/5 min-w-0 shrink-0">
        {track.artist}
      </Text>
    </>
  );
}

function Results({
  text,
  picked,
  onToggle,
}: {
  text: string;
  picked: readonly Track[];
  onToggle: (track: Track) => void;
}) {
  const results = useQuery({ ...searchQuery(text), enabled: text !== '' });
  // Song search goes by title, so an artist's name brings their songs in after those.
  const artistId = results.data?.artists[0]?.id ?? null;
  const byArtist = useQuery({
    ...tracksQuery({ kind: 'artist', artistId: artistId ?? 0 }),
    enabled: artistId !== null,
  });
  const found = [...(results.data?.tracks ?? []), ...(artistId === null ? [] : (byArtist.data ?? []))];
  const tracks = found
    .filter(({ id, isMissing }, index) => !isMissing && found.findIndex((other) => other.id === id) === index)
    .slice(0, RESULTS);

  if (text === '') {
    return (
      <Text color="muted" className="py-1">
        Search for songs to add
      </Text>
    );
  }
  if (results.isError)
    return <ErrorState error={results.error} onRetry={() => void results.refetch()} className="size-auto" />;
  if (results.isPending || (artistId !== null && byArtist.isPending)) {
    return (
      <div aria-hidden className="flex flex-col gap-1">
        <Skeleton className="h-row w-full" />
        <Skeleton className="h-row w-full" />
        <Skeleton className="h-row w-full" />
      </div>
    );
  }
  if (tracks.length === 0) {
    return (
      <Text color="muted" className="content-in py-1">
        No songs match. Try fewer words
      </Text>
    );
  }
  return (
    <div className="content-in flex flex-col">
      {tracks.map((track) => {
        const isPicked = picked.some(({ id }) => id === track.id);
        return (
          <Button
            key={track.id}
            variant="row"
            size="row"
            className="h-row"
            aria-pressed={isPicked}
            onClick={() => onToggle(track)}
          >
            <TrackLine track={track} />
            {isPicked ? (
              <Check aria-hidden className="shrink-0 text-accent" />
            ) : (
              <Plus aria-hidden className="shrink-0 text-text-muted" />
            )}
          </Button>
        );
      })}
    </div>
  );
}

/** A name and songs to put in, picked by search. Mounted only while it's open, so each opening starts fresh. */
export function PlaylistEditor({ title, submitLabel, initialName = '', initialTracks = [], onSubmit, onClose }: Props) {
  const [name, setName] = useState(initialName);
  const nameField = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<readonly Track[]>(() =>
    initialTracks.filter(({ id }, index) => initialTracks.findIndex((other) => other.id === id) === index),
  );
  const text = useSearchText(query);
  const [problem, setProblem] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  // Whoever mounted it takes it away, once it has had the time to close.
  const [isOpen, setIsOpen] = useState(true);
  useTimeoutWhile(!isOpen, useMotionDuration('--dur-mid') * 1000, onClose);
  const isBlank = name.trim() === '';

  function toggle(track: Track): void {
    setPicked(
      picked.some(({ id }) => id === track.id) ? picked.filter(({ id }) => id !== track.id) : [...picked, track],
    );
  }

  function move(ids: number[], toIndex: number): void {
    const moving = picked.filter(({ id }) => ids.includes(id));
    const rest = picked.filter(({ id }) => !ids.includes(id));
    setPicked([...rest.slice(0, toIndex), ...moving, ...rest.slice(toIndex)]);
  }

  function submit(event: SyntheticEvent): void {
    event.preventDefault();
    if (isBlank || isSaving) return;
    setIsSaving(true);
    void onSubmit({ name: name.trim(), trackIds: picked.map(({ id }) => id) }).then((result) => {
      setIsSaving(false);
      if (result.ok) setIsOpen(false);
      else setProblem(result.error.message);
    });
  }

  return (
    <Modal
      onOpenAutoFocus={(event) => {
        // Radix would take the close button, the first thing it finds. The name is what's wanted first.
        event.preventDefault();
        nameField.current?.focus();
      }}
      open={isOpen}
      onOpenChange={setIsOpen}
      title={title}
      closeLabel={`Close ${title}`}
      size="lg"
      className="h-232"
    >
      <form onSubmit={(event: FormEvent) => submit(event)} className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-col gap-1 p-gutter">
          <Input
            ref={nameField}
            aria-label="Playlist name"
            className="h-tap"
            placeholder="Name"
            autoComplete="off"
            maxLength={200}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setProblem(null);
            }}
          />
          {problem === null ? null : (
            <Text as="p" variant="meta" color="danger" role="alert">
              {problem}
            </Text>
          )}
        </div>
        <div className="flex min-h-0 flex-1">
          <section className="flex min-w-0 flex-1 flex-col gap-gap p-gutter">
            <SearchInput value={query} onValueChange={setQuery} label="Search for songs to add" />
            <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
              <Results text={text} picked={picked} onToggle={toggle} />
            </div>
          </section>
          <Divider orientation="vertical" />
          <section className="flex min-w-0 flex-1 flex-col gap-gap p-gutter">
            <Text as="h3" variant="meta" color="muted" className="flex h-tap items-center">
              {picked.length === 0 ? 'Nothing picked yet' : formatPlural(picked.length, 'song')}
            </Text>
            <DragReorder ids={picked.map(({ id }) => id)} onMove={move}>
              {/* Marked, so a drag scrolls it on reaching an edge. */}
              <div data-scroller className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
                {picked.map((track) => (
                  <div key={track.id} data-drag-id={track.id} className="flex h-row min-w-0 items-center gap-gap">
                    {/* A real handle, or a finger couldn't pick a row up: on the row itself it scrolls. */}
                    <DragHandle className="-mx-2" />
                    <TrackLine track={track} />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Take ${track.title} out`}
                      onClick={() => toggle(track)}
                    >
                      <X aria-hidden />
                    </Button>
                  </div>
                ))}
              </div>
            </DragReorder>
          </section>
        </div>
        <Divider />
        <div className="flex shrink-0 justify-end gap-2 p-section">
          <Button variant="outline" onClick={() => setIsOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={isBlank} loading={isSaving} onClick={submit}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
