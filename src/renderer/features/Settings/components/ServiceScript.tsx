import { LYRICS_SCRIPT_EXAMPLE, SCRIPT_MAX_CHARS, SCRIPT_TIME_MS } from '@shared/onlineServices';
import { Button } from '@/components/ui/Button';
import { Collapse } from '@/components/ui/Collapse';
import { Text } from '@/components/ui/Text';
import { Textarea } from '@/components/ui/Textarea';

type Props = {
  name: string;
  saved: string | null;
  draft: string;
  onDraftChange: (draft: string) => void;
  onSave: (script: string | null) => void;
  isSaving: boolean;
  problem: string | null;
};

/** A script of the person's that asks a different service in this one's place. */
export function ServiceScript({ name, saved, draft, onDraftChange, onSave, isSaving, problem }: Props) {
  const isUnsaved = draft.trim() !== (saved ?? '').trim();

  return (
    <div className="flex flex-col gap-1">
      <Text variant="meta" color="muted">
        A different service
      </Text>
      <Text as="p" variant="meta" color="muted">
        For a service that answers some other way: a script saying how to ask it and how to read what it says. While
        there is one, it's asked instead of {name}, and searching lyrics by hand is off. It runs sealed off from your
        files and the network, at most {SCRIPT_TIME_MS} ms at a time, and what it gives back is checked before anything
        uses it
      </Text>
      <Textarea
        isCode
        aria-label={`Script in place of ${name}`}
        rows={12}
        maxLength={SCRIPT_MAX_CHARS}
        placeholder="Paste a script, or start from the example, which asks LRCLIB the same way and shows the shape"
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
      />
      <Collapse open={problem !== null}>
        <Text as="p" variant="meta" color="danger">
          {problem}
        </Text>
      </Collapse>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="md" onClick={() => onDraftChange(LYRICS_SCRIPT_EXAMPLE)}>
          Start from the example
        </Button>
        <Button variant="outline" size="md" disabled={!isUnsaved} loading={isSaving} onClick={() => onSave(draft)}>
          Save script
        </Button>
        <Button
          variant="outline"
          size="md"
          disabled={saved === null}
          onClick={() => {
            onDraftChange('');
            onSave(null);
          }}
        >
          Remove script
        </Button>
      </div>
    </div>
  );
}
