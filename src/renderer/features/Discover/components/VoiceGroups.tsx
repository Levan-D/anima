import type { DiscoverDetail } from '@shared/domain';
import { Accordion } from '@/components/ui/Accordion';
import { Text } from '@/components/ui/Text';
import { formatCount } from '@/lib/format';
import { voiceGroups } from '@/features/Discover/utils/suggestions';
import { VoiceList } from './VoiceList';

type Props = {
  voices: DiscoverDetail['voices'];
  linkedTracks: ReadonlyMap<number, number>;
};

/** A long list by strength, with only the strongest open. Its header says the strength, so its rows don't. */
export function VoiceGroups({ voices, linkedTracks }: Props) {
  const groups = voiceGroups(voices);
  const strongest = groups[0]?.strength;

  return (
    <Accordion
      className="-mx-section"
      defaultOpen={strongest === undefined ? [] : [strongest]}
      items={groups.map(({ strength, voices: members }) => ({
        value: strength,
        header: (
          <>
            <Text truncate className="min-w-0">
              {strength}
            </Text>
            <Text variant="meta" color="muted" tabular className="shrink-0">
              {formatCount(members.length)}
            </Text>
          </>
        ),
        content: <VoiceList voices={members} linkedTracks={linkedTracks} />,
      }))}
    />
  );
}
