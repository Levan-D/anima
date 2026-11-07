import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ONLINE_SERVICES, type OnlineServiceId, type OnlineServiceSetting } from '@shared/onlineServices';
import { Button } from '@/components/ui/Button';
import { Collapse } from '@/components/ui/Collapse';
import { ErrorState } from '@/components/ui/ErrorState';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ModalSection } from '@/components/ui/ModalSection';
import { Skeleton } from '@/components/ui/Skeleton';
import { Switch } from '@/components/ui/Switch';
import { Text, type TextColor } from '@/components/ui/Text';
import { useSaveAddress, useSwitchService, useTestService } from '@/features/Settings/hooks/useOnlineService';
import { settingsQuery } from '@/lib/libraryQueries';

type TestState = ReturnType<typeof useTestService>;

function testLine(test: TestState, isUnsaved: boolean): { words: string; color: TextColor } {
  if (isUnsaved) return { words: 'Save the address to test it', color: 'muted' };
  if (test.isPending) return { words: 'Asking', color: 'muted' };
  if (test.isError) return { words: test.error.message, color: 'danger' };
  if (test.isSuccess) return { words: `Works. It answered in ${test.data.ms} ms`, color: 'accent' };
  return { words: 'Sends one request to the saved address, even with the service off', color: 'muted' };
}

type SectionProps = {
  service: OnlineServiceId;
  setting: OnlineServiceSetting;
};

/** One service: whether it's asked, where, and a way to check that address answers. */
function ServiceSection({ service, setting }: SectionProps) {
  const { name, defaultAddress } = ONLINE_SERVICES[service];
  const [draft, setDraft] = useState(setting.address ?? '');
  const switchService = useSwitchService(service);
  const save = useSaveAddress(service);
  const test = useTestService(service);
  const isUnsaved = draft.trim() !== (setting.address ?? '');
  const problem = save.error?.message ?? null;
  const tested = testLine(test, isUnsaved);

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (isUnsaved) save.mutate(draft.trim() === '' ? null : draft);
  }

  return (
    <ModalSection title={name}>
      <Switch checked={setting.isOn} onCheckedChange={(isOn) => switchService.mutate(isOn)} className="justify-between">
        <Text>Ask {name}</Text>
      </Switch>
      <form onSubmit={submit} className="flex flex-col gap-1">
        <Text variant="meta" color="muted">
          Address
        </Text>
        <div className="flex flex-wrap gap-2">
          <Input
            aria-label={`${name} address`}
            placeholder={defaultAddress}
            value={draft}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => {
              setDraft(event.target.value);
              save.reset();
              test.reset();
            }}
            className="h-10 flex-[1_1_16em]"
          />
          <div className="flex gap-2">
            <Button type="submit" variant="outline" size="md" disabled={!isUnsaved} loading={save.isPending}>
              Save
            </Button>
            <Button
              variant="outline"
              size="md"
              disabled={setting.address === null}
              onClick={() => {
                setDraft('');
                save.mutate(null);
              }}
            >
              Reset
            </Button>
          </div>
        </div>
        <Collapse open={problem !== null}>
          <Text as="p" variant="meta" color="danger">
            {problem}
          </Text>
        </Collapse>
        <Text as="p" variant="meta" color="muted">
          Empty asks {defaultAddress}. Another address only works if it answers the way {name} does, such as a mirror or
          a copy you run yourself
        </Text>
      </form>
      <div className="flex flex-wrap items-center gap-x-gap gap-y-2">
        <Button variant="outline" size="md" disabled={isUnsaved} loading={test.isPending} onClick={() => test.mutate()}>
          Test
        </Button>
        <Text as="p" variant="meta" color={tested.color} className="min-w-0 flex-[1_1_16em]">
          {tested.words}
        </Text>
      </div>
    </ModalSection>
  );
}

type Props = {
  title: string;
  services: readonly OnlineServiceId[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Where a dataset asks online, for when a service moves or shuts down. */
export function ServicesDialog({ title, services, open, onOpenChange }: Props) {
  const settings = useQuery(settingsQuery);

  function body() {
    if (settings.isPending) return <Skeleton className="my-section h-40 w-full" />;
    if (settings.isError) return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;
    return services.map((service) => {
      const setting = settings.data.onlineServices[service];
      // A saved address starts the field over from it, and what was typed and tested went with the old one.
      return <ServiceSection key={`${service}:${setting.address ?? ''}`} service={service} setting={setting} />;
    });
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description="Where the app asks, in case a service moves or shuts down"
      closeLabel={`Close ${title}`}
      size="lg"
      className="h-auto w-200"
    >
      <div data-testid="services-dialog" className="min-h-0 flex-1 overflow-y-auto px-section">
        {body()}
      </div>
    </Modal>
  );
}
