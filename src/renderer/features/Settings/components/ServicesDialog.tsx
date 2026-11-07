import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import {
  DISCOVER_SCRIPT_EXAMPLE,
  LYRICS_SCRIPT_EXAMPLE,
  ONLINE_SERVICES,
  scriptFor,
  type OnlineServiceId,
  type OnlineServiceSetting,
} from '@shared/onlineServices';
import { Button } from '@/components/ui/Button';
import { Collapse } from '@/components/ui/Collapse';
import { ErrorState } from '@/components/ui/ErrorState';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ModalSection } from '@/components/ui/ModalSection';
import { Skeleton } from '@/components/ui/Skeleton';
import { Switch } from '@/components/ui/Switch';
import { Text, type TextColor } from '@/components/ui/Text';
import { ServiceScript, type ScriptWords } from '@/features/Settings/components/ServiceScript';
import {
  useSaveAddress,
  useSaveScript,
  useSwitchService,
  useTestService,
} from '@/features/Settings/hooks/useOnlineService';
import { settingsQuery } from '@/lib/libraryQueries';

type TestState = ReturnType<typeof useTestService>;

/** The services whose section holds a script, and what it stands in for. */
const SCRIPT_WORDS: Partial<Record<OnlineServiceId, ScriptWords>> = {
  lrclib: { replaces: 'LRCLIB', alsoChanges: 'and searching lyrics by hand is off', example: LYRICS_SCRIPT_EXAMPLE },
  listenbrainz: { replaces: 'MusicBrainz and ListenBrainz Labs', alsoChanges: null, example: DISCOVER_SCRIPT_EXAMPLE },
};

function testLine(test: TestState, isUnsaved: boolean, runsScript: boolean): { words: string; color: TextColor } {
  if (isUnsaved) return { words: 'Save first to test it', color: 'muted' };
  if (test.isPending) return { words: 'Asking', color: 'muted' };
  if (test.isError) return { words: test.error.message, color: 'danger' };
  if (test.isSuccess) {
    const took = `It answered in ${test.data.ms} ms`;
    return { words: test.data.note === null ? `Works. ${took}` : `Works. ${took}. ${test.data.note}`, color: 'accent' };
  }
  if (runsScript) return { words: 'Runs your script on a sample, even with the service off', color: 'muted' };
  return { words: 'Sends one request to the saved address, even with the service off', color: 'muted' };
}

type SectionProps = {
  service: OnlineServiceId;
  setting: OnlineServiceSetting;
  /** The script asked instead of this service, kept in this section or another's. */
  standIn: string | null;
};

function addressNote(isStoodIn: boolean, holdsScript: boolean, name: string, defaultAddress: string): string {
  if (isStoodIn && holdsScript)
    return 'Your script says where to ask, so this address waits until the script is removed';
  if (isStoodIn) return 'A script further down stands in for this too, so this address waits until it is removed';
  return `Empty asks ${defaultAddress}. Another address only works if it answers the way ${name} does, such as a mirror or a copy you run yourself`;
}

/** One service: whether it's asked, where, a script to ask another in its place, and a way to check it answers. */
function ServiceSection({ service, setting, standIn }: SectionProps) {
  const { name, defaultAddress } = ONLINE_SERVICES[service];
  const [address, setAddress] = useState(setting.address ?? '');
  const [script, setScript] = useState(setting.script ?? '');
  const switchService = useSwitchService(service);
  const saveAddress = useSaveAddress(service);
  const saveScript = useSaveScript(service);
  const test = useTestService(service);
  const scriptWords = SCRIPT_WORDS[service];
  const isStoodIn = standIn !== null;
  // A script kept in another section stands in for this one too, and this one's switch doesn't decide it.
  const isStoodInFromElsewhere = isStoodIn && scriptWords === undefined;
  const isAddressUnsaved = address.trim() !== (setting.address ?? '');
  const isScriptUnsaved = script.trim() !== (setting.script ?? '').trim();
  const tested = testLine(test, isAddressUnsaved || isScriptUnsaved, isStoodIn && !isStoodInFromElsewhere);

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (isAddressUnsaved) saveAddress.mutate(address.trim() === '' ? null : address);
  }

  return (
    <ModalSection title={name}>
      <Switch
        checked={setting.isOn}
        disabled={isStoodInFromElsewhere}
        onCheckedChange={(isOn) => switchService.mutate(isOn)}
        className="justify-between"
      >
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
            value={address}
            disabled={isStoodIn}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => {
              setAddress(event.target.value);
              saveAddress.reset();
              test.reset();
            }}
            className="h-10 flex-[1_1_16em]"
          />
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="outline"
              size="md"
              disabled={!isAddressUnsaved || isStoodIn}
              loading={saveAddress.isPending}
            >
              Save
            </Button>
            <Button
              variant="outline"
              size="md"
              disabled={setting.address === null || isStoodIn}
              onClick={() => {
                setAddress('');
                saveAddress.mutate(null);
              }}
            >
              Reset
            </Button>
          </div>
        </div>
        <Collapse open={saveAddress.error !== null}>
          <Text as="p" variant="meta" color="danger">
            {saveAddress.error?.message}
          </Text>
        </Collapse>
        <Text as="p" variant="meta" color="muted">
          {addressNote(isStoodIn, scriptWords !== undefined, name, defaultAddress)}
        </Text>
      </form>
      {scriptWords === undefined ? null : (
        <ServiceScript
          words={scriptWords}
          saved={setting.script}
          draft={script}
          onDraftChange={(next) => {
            setScript(next);
            saveScript.reset();
            test.reset();
          }}
          onSave={(next) => saveScript.mutate(next)}
          isSaving={saveScript.isPending}
          problem={saveScript.error?.message ?? null}
        />
      )}
      <div className="flex flex-wrap items-center gap-x-gap gap-y-2">
        <Button
          variant="outline"
          size="md"
          disabled={isAddressUnsaved || isScriptUnsaved}
          loading={test.isPending}
          onClick={() => test.mutate()}
        >
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
      const standIn = scriptFor(settings.data.onlineServices, service);
      // What's saved starts the fields over from it, and what was typed and tested went with the old one.
      const saved = `${service}:${setting.address ?? ''}:${standIn ?? ''}`;
      return <ServiceSection key={saved} service={service} setting={setting} standIn={standIn} />;
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
