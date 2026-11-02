import { REPLAY_GAIN_MODES, type ReplayGainMode } from '@shared/domain';
import { ModalSection } from '@/components/ui/ModalSection';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Switch } from '@/components/ui/Switch';
import { Text } from '@/components/ui/Text';
import { StayAwakeSection } from '@/features/Settings/components/StayAwakeSection';
import { setEndless, setOutputMode, setReplayGainMode } from '@/lib/playerActions';
import { usePlayer } from '@/lib/playerStore';

const MODE_WORDS: Record<ReplayGainMode, string> = { off: 'Off', track: 'Track', album: 'Album' };
const MODE_HINTS: Record<ReplayGainMode, string> = {
  off: 'Every file plays as loud as it was made',
  track: 'Every song plays about equally loud, even on shuffle',
  album: 'Every album plays about equally loud, and its quiet songs stay quiet',
};
const MODE_ITEMS = REPLAY_GAIN_MODES.map((value) => ({ value, label: MODE_WORDS[value] }));

export function PlaybackSection() {
  const mode = usePlayer((state) => state.replayGainMode);
  const isExclusive = usePlayer((state) => state.outputMode === 'exclusive');
  const isEndless = usePlayer((state) => state.endless);

  return (
    <section aria-label="Playback" className="flex flex-col">
      <ModalSection title="ReplayGain">
        <Text as="p" variant="meta" color="muted">
          Evens out how loud your music plays, using levels a tool like foobar2000 wrote into its tags. Files without
          them play as they are
        </Text>
        <SegmentedControl label="ReplayGain" items={MODE_ITEMS} value={mode} onValueChange={setReplayGainMode} />
        <Text as="p" variant="meta" color="muted">
          {MODE_HINTS[mode]}
        </Text>
      </ModalSection>
      <ModalSection title="Exclusive mode">
        <Switch checked={isExclusive} onCheckedChange={(isOn) => setOutputMode(isOn ? 'exclusive' : 'shared')}>
          <Text className="min-w-0 flex-1">Have the sound device alone</Text>
        </Switch>
        <Text as="p" variant="meta" color="muted">
          Other apps stay silent while this one holds the device. Off, Windows mixes this with other apps
        </Text>
      </ModalSection>
      <ModalSection title="Endless">
        <Switch checked={isEndless} onCheckedChange={setEndless}>
          <Text className="min-w-0 flex-1">Keep going when the queue runs out</Text>
        </Switch>
        <Text as="p" variant="meta" color="muted">
          Adds similar tracks from your library as it nears the end. Off, playback stops at the end of the queue
        </Text>
      </ModalSection>
      <StayAwakeSection />
    </section>
  );
}
