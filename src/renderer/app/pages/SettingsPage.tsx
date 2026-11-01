import { WideLayout } from '@/app/WideLayout';
import { Settings } from '@/features/Settings/Settings';
import { Transport } from '@/features/Transport/Transport';

export function SettingsPage() {
  return (
    <WideLayout transport={<Transport />}>
      <Settings />
    </WideLayout>
  );
}
