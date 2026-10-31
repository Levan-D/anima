import { useState, type FormEvent, type SyntheticEvent } from 'react';
import type { Result } from '@shared/result';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { Text } from '@/components/ui/Text';

type Props = {
  title: string;
  submitLabel: string;
  /** Announced to screen readers: the field has no visible label. */
  fieldLabel: string;
  initialName?: string;
  /** Stays open with what went wrong, such as a name that's taken, unless this says it worked. */
  onSubmit: (name: string) => Promise<Result<unknown>>;
  onClose: () => void;
  /** Where focus goes afterwards, when what opened it has gone. */
  onCloseAutoFocus?: (event: Event) => void;
};

/** Asks for a name. Mounted only while it's open, so each opening starts from `initialName`. */
export function NameDialog({
  title,
  submitLabel,
  fieldLabel,
  initialName = '',
  onSubmit,
  onClose,
  onCloseAutoFocus,
}: Props) {
  const [name, setName] = useState(initialName);
  const [problem, setProblem] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const isBlank = name.trim() === '';

  function submit(event: SyntheticEvent): void {
    // Using an action closes the dialog otherwise, and whether it should close isn't known yet.
    event.preventDefault();
    if (isBlank || isSaving) return;
    setIsSaving(true);
    void onSubmit(name.trim()).then((result) => {
      setIsSaving(false);
      if (result.ok) onClose();
      else setProblem(result.error.message);
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={title}
      {...(onCloseAutoFocus ? { onCloseAutoFocus } : {})}
      actions={[
        <Button key="cancel" variant="outline">
          Cancel
        </Button>,
        <Button key="save" variant="primary" disabled={isBlank} loading={isSaving} onClick={submit}>
          {submitLabel}
        </Button>,
      ]}
    >
      <form onSubmit={(event: FormEvent) => submit(event)} className="flex h-tap flex-col">
        <Input
          aria-label={fieldLabel}
          autoComplete="off"
          maxLength={200}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setProblem(null);
          }}
          onFocus={(event) => event.currentTarget.select()}
        />
      </form>
      {problem === null ? null : (
        <Text as="p" color="danger" role="alert">
          {problem}
        </Text>
      )}
    </Dialog>
  );
}
