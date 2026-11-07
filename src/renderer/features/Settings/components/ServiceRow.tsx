import { Button } from '@/components/ui/Button';
import { Divider } from '@/components/ui/Divider';
import { Text } from '@/components/ui/Text';

type Props = {
  title: string;
  /** What it's asked for, and when. */
  description: string;
  /** Where it asks now. */
  source: string;
  onConfigure: () => void;
};

/** A service asked only when something calls for it, so there's nothing to bring up to date: only where it's asked. */
export function ServiceRow({ title, description, source, onConfigure }: Props) {
  return (
    <>
      <Divider />
      <section aria-label={title} className="flex flex-col py-block">
        <div className="flex flex-wrap items-center justify-between gap-x-gap gap-y-2">
          <div className="flex min-w-0 flex-[1_1_20em] flex-col">
            <Text as="h3" variant="lead">
              {title}
            </Text>
            <Text as="p" variant="meta" color="muted">
              {description}
            </Text>
            <Text as="p" variant="meta" color="accent">
              Asks {source}
            </Text>
          </div>
          <Button variant="outline" size="md" onClick={onConfigure} className="shrink-0">
            Configure
          </Button>
        </div>
      </section>
    </>
  );
}
