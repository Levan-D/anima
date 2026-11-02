import { Modal } from '@/components/ui/Modal';
import { Text } from '@/components/ui/Text';

const STEPS = [
  {
    title: '1. Pick your headphone',
    words:
      'In the first dropdown, press Find on AutoEq and search for your model. Import a file if you have your own measurement. Each entry is one pair, measured by one person on one rig.',
  },
  {
    title: '2. Pick a target',
    words:
      'A target is a curve to aim for. In the second dropdown, the ones at the top can be drawn against your headphone. The grey line is your headphone as measured, the white line adds your EQ, and the colored line is the target.',
  },
  {
    title: '3. Set the EQ',
    words:
      "Match to target fits an EQ to the target you picked. Use AutoEq's correction loads the EQ AutoEq made for that measurement, whatever target is picked. You can also drag the points by hand. Press Save as new to keep the result.",
  },
  {
    title: '4. Listen',
    words: 'Hold to hear EQ off switches to no EQ at a similar loudness for as long as you hold it. Your ears decide.',
  },
];

const QUESTIONS = [
  {
    title: 'What is a rig?',
    words:
      'The artificial ear or head a headphone is measured on, such as a GRAS 43AG or a B&K 5128. Rigs read the same headphone differently: across rigs, the same model spreads about 1 dB from 100 Hz to 2 kHz, 4 dB from 2 to 6 kHz and 7 dB from 6 to 10 kHz. So a measurement and a target are only compared when they come from the same or a close rig.',
  },
  {
    title: 'Do I need several measurements of one headphone?',
    words:
      "Usually not. One gives you the targets on its rig, and AutoEq's correction doesn't depend on the target. Fetch another only for something its rig can't do, such as a 5128 measurement for 5128 targets or Preference range. Each one is its own entry in the list, and the dropdown says which rig it's on.",
  },
  {
    title: 'Why is a button greyed out?',
    words:
      'Difference, Bass and Match to target need a target from the same or a close rig. Preference range needs an over-ear measured on a 5128. The line above the graph says what to change.',
  },
  {
    title: "How close is this to what I'm hearing?",
    words:
      "It's a prediction from someone else's pair. Your pair, your head and the seal all change it, most of all above 6 kHz and in the bass.",
  },
];

type SectionProps = {
  title: string;
  words: string;
};

function Section({ title, words }: SectionProps) {
  return (
    <div className="flex flex-col gap-1">
      <Text as="h3" variant="label">
        {title}
      </Text>
      <Text as="p" variant="meta" color="muted">
        {words}
      </Text>
    </div>
  );
}

type Props = {
  onClose: () => void;
};

export function HeadphoneHelp({ onClose }: Props) {
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="How Headphones works"
      closeLabel="Close help"
      size="lg"
    >
      <div data-testid="hp-help" className="flex min-h-0 flex-1 flex-col gap-section overflow-y-auto p-section">
        <div className="flex flex-col gap-gap">
          {STEPS.map(({ title, words }) => (
            <Section key={title} title={title} words={words} />
          ))}
        </div>
        <div className="flex flex-col gap-gap">
          {QUESTIONS.map(({ title, words }) => (
            <Section key={title} title={title} words={words} />
          ))}
        </div>
      </div>
    </Modal>
  );
}
