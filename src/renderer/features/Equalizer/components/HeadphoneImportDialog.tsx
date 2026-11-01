import { ChevronDown } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';
import {
  HEADPHONE_NAME_MAX,
  RIG_FAMILIES,
  RIG_FAMILY_WORDS,
  type HeadphoneKind,
  type HeadphoneState,
  type RigFamily,
} from '@shared/headphone';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { DropdownMenu } from '@/components/ui/DropdownMenu';
import { Input } from '@/components/ui/Input';
import { Text } from '@/components/ui/Text';
import { call } from '@/lib/api';

const WORDS: Record<HeadphoneKind, { title: string; name: string; description: string }> = {
  measurement: {
    title: 'Import a measurement',
    name: 'Headphone',
    description: 'A file you have, as CSV with frequency,raw or as tab-separated text from Room EQ Wizard',
  },
  target: {
    title: 'Import a target',
    name: 'Target name',
    description: 'A target only means something on the rig it was defined on, so say which one',
  },
};

type Props = {
  kind: HeadphoneKind;
  onDone: (state: HeadphoneState) => void;
  onClose: () => void;
};

type FieldProps = {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
};

function Field({ label, value, placeholder, onChange }: FieldProps) {
  return (
    <label className="flex flex-col gap-1">
      <Text variant="meta" color="muted">
        {label}
      </Text>
      <div className="flex h-tap">
        <Input
          className="border border-outline"
          autoComplete="off"
          maxLength={HEADPHONE_NAME_MAX}
          value={value}
          placeholder={placeholder}
          onChange={({ target }) => onChange(target.value)}
        />
      </div>
    </label>
  );
}

/** What it is, whose it is and what rig, first, then the file. The file dialog is main's, so a path never comes through here. */
export function HeadphoneImportDialog({ kind, onDone, onClose }: Props) {
  const [name, setName] = useState('');
  const [source, setSource] = useState('');
  const [family, setFamily] = useState<RigFamily>('unknown');
  const [detail, setDetail] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const { title, name: nameLabel, description } = WORDS[kind];
  const isBlank = name.trim() === '' || source.trim() === '';

  function choose(event: SyntheticEvent): void {
    event.preventDefault();
    if (isBlank || isBusy) return;
    setIsBusy(true);
    setProblem(null);
    const exact = detail.trim();
    void call('headphones.import', {
      kind,
      name: name.trim(),
      source: source.trim(),
      rig: { family, detail: exact === '' ? null : exact },
    }).then((result) => {
      setIsBusy(false);
      if (!result.ok) setProblem(result.error.message);
      else if (result.value !== null) {
        onDone(result.value);
        onClose();
      }
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={title}
      description={description}
      actions={[
        <Button key="cancel" variant="outline">
          Cancel
        </Button>,
        <Button key="choose" variant="primary" disabled={isBlank} loading={isBusy} onClick={choose}>
          Choose file
        </Button>,
      ]}
    >
      <Field label={nameLabel} value={name} onChange={setName} />
      <Field label="Measured by" value={source} onChange={setSource} placeholder="Who it's from" />
      <div className="flex flex-col gap-1">
        <Text variant="meta" color="muted">
          Rig
        </Text>
        <DropdownMenu
          align="start"
          entries={RIG_FAMILIES.map((one) => ({
            kind: 'item',
            label: RIG_FAMILY_WORDS[one],
            onSelect: () => setFamily(one),
          }))}
        >
          <Button
            variant="outline"
            size="md"
            aria-label={`Rig: ${RIG_FAMILY_WORDS[family]}`}
            className="[&>span]:w-full [&>span]:justify-between"
          >
            <span className="min-w-0 truncate">{RIG_FAMILY_WORDS[family]}</span>
            <ChevronDown aria-hidden />
          </Button>
        </DropdownMenu>
      </div>
      <Field
        label="Exact rig, if you know it"
        value={detail}
        onChange={setDetail}
        placeholder="Only an exact match counts as the same rig"
      />
      {problem === null ? null : (
        <Text as="p" variant="meta" color="danger" role="alert">
          {problem}
        </Text>
      )}
    </Dialog>
  );
}
