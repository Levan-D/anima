import { Pill } from '@/components/ui/Pill';

type Props = { isOn: boolean; isSecondary?: boolean; label: string; onClick: () => void; children: string };

/** Lit while it's what was said. */
export function SayPill({ isOn, isSecondary = false, label, onClick, children }: Props) {
  return (
    <Pill
      isOutlined
      isSecondary={isSecondary}
      data-state={isOn ? 'on' : 'off'}
      aria-pressed={isOn}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </Pill>
  );
}
