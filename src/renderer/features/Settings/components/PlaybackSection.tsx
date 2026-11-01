import { REPLAY_GAIN_MODES, type ReplayGainMode } from '@shared/domain';
import { ModalSection } from '@/components/ui/ModalSection';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Text } from '@/components/ui/Text';
import { StayAwakeSection } from '@/features/Settings/components/StayAwakeSection';
import { setReplayGainMode } from '@/lib/playerActions';
import { usePlayer } from '@/lib/playerStore';

const MODE_WORDS: Record<ReplayGainMode, string> = { off: 'Off', track: 'Track', album: 'Album' };
const MODE_ITEMS = REPLAY_GAIN_MODES.map((value) => ({ value, label: MODE_WORDS[value] }));

export function PlaybackSection() {
  const mode = usePlayer((state) => state.replayGainMode);

  return (
    <section aria-label="Playback" className="flex flex-col">
      <ModalSection title="ReplayGain">
        <SegmentedControl label="ReplayGain" items={MODE_ITEMS} value={mode} onValueChange={setReplayGainMode} />
        <Text as="p" variant="meta" color="muted">
          Reads the levels foobar wrote into the tags
        </Text>
      </ModalSection>
      <StayAwakeSection />
    </section>
  );
}
