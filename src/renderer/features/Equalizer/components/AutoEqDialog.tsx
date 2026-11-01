import { Search } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { rigWords, type AutoEqSearch, type HeadphoneState } from '@shared/headphone';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Text } from '@/components/ui/Text';
import { call } from '@/lib/api';

const WHAT_IT_IS =
  "AutoEq is a public collection of headphone measurements and presets, from many people's rigs. Nothing is downloaded until you search, and then only its index. Choosing a headphone downloads one measurement and its preset, from a fixed version of the collection, into this app's data on this machine. Its data has no stated license, so none of it ships with the app.";
const ONE_UNIT = "It's one unit on one rig, not your pair, and the preset is AutoEq's EQ for that unit.";

type Props = {
  onDone: (state: HeadphoneState) => void;
  onClose: () => void;
};

function countWords({ entries, total }: AutoEqSearch): string {
  if (total === 0) return 'Nothing found. Try fewer words, or just the model';
  return total > entries.length
    ? `The first ${entries.length} of ${total}. More words narrow it down`
    : `${total} found`;
}

/** Search AutoEq's index and fetch one headphone. Only ever because someone asked. */
export function AutoEqDialog({ onDone, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<AutoEqSearch | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [fetchingId, setFetchingId] = useState<number | null>(null);

  function search(event: FormEvent): void {
    event.preventDefault();
    const wanted = query.trim();
    if (wanted === '' || isSearching) return;
    setIsSearching(true);
    setProblem(null);
    void call('autoeq.search', { query: wanted }).then((result) => {
      setIsSearching(false);
      if (result.ok) setFound(result.value);
      else setProblem(result.error.message);
    });
  }

  function fetchOne(entryId: number): void {
    if (fetchingId !== null) return;
    setFetchingId(entryId);
    setProblem(null);
    void call('autoeq.fetch', { entryId }).then((result) => {
      setFetchingId(null);
      if (result.ok) {
        onDone(result.value);
        onClose();
      } else setProblem(result.error.message);
    });
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Find on AutoEq"
      closeLabel="Close AutoEq"
      size="lg"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-gap p-section">
        <Text as="p" variant="meta" color="muted">
          {WHAT_IT_IS}
        </Text>
        <form onSubmit={search} className="flex h-tap shrink-0 gap-2">
          <Input
            className="border border-outline"
            aria-label="Headphone"
            autoComplete="off"
            placeholder="Brand and model"
            maxLength={200}
            value={query}
            onChange={({ target }) => setQuery(target.value)}
          />
          <Button type="submit" variant="primary" size="md" loading={isSearching} disabled={query.trim() === ''}>
            <Search aria-hidden />
            Search
          </Button>
        </form>
        {problem === null ? null : (
          <Text as="p" variant="meta" color="danger" role="alert">
            {problem}
          </Text>
        )}
        {found === null ? null : (
          <Text variant="meta" color="muted" className="shrink-0">
            {countWords(found)}
          </Text>
        )}
        <div data-testid="autoeq-results" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {found?.entries.map(({ id, name, source, form, rig, isPresetOnly }) => (
            <Button
              key={id}
              variant="row"
              size="row"
              loading={fetchingId === id}
              className="h-tap shrink-0"
              onClick={() => fetchOne(id)}
            >
              <Text className="min-w-0 flex-1 truncate">{name}</Text>
              <Text variant="meta" color="muted" className="shrink-0">
                {isPresetOnly
                  ? `${source}, ${form}, preset only: the measurement isn't public`
                  : `${source}, ${rigWords(rig)}, ${form}`}
              </Text>
            </Button>
          ))}
        </div>
        <Text as="p" variant="meta" color="faint" className="shrink-0">
          {ONE_UNIT}
        </Text>
      </div>
    </Modal>
  );
}
