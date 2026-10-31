import { REPLAY_GAIN_MODES, type ReplayGainMode } from '@shared/domain';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Text } from '@/components/ui/Text';
import { Section } from '@/features/Settings/components/Section';
import { setReplayGainMode } from '@/lib/playerActions';
import { usePlayer } from '@/lib/playerStore';

const MODE_WORDS: Record<ReplayGainMode, string> = { off: 'Off', track: 'Track', album: 'Album' };
const MODE_ITEMS = REPLAY_GAIN_MODES.map((value) => ({ value, label: MODE_WORDS[value] }));

export function PlaybackSection() {
  const mode = usePlayer((state) => state.replayGainMode);

  return (
    <Section title="Playback" hideTitle>
      <div className="flex flex-col gap-1">
        <Text variant="meta" color="muted">
          ReplayGain
        </Text>
        <SegmentedControl label="ReplayGain" items={MODE_ITEMS} value={mode} onValueChange={setReplayGainMode} />
      </div>
      <Text as="p" variant="meta" color="muted">
        Reads the levels foobar wrote into the tags
      </Text>
    </Section>
  );
}
