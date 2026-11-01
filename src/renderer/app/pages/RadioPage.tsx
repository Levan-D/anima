import { WideLayout } from '@/app/WideLayout';
import { Radio } from '@/features/Radio/Radio';
import { Transport } from '@/features/Transport/Transport';

export function RadioPage() {
  return (
    <WideLayout transport={<Transport />}>
      <Radio />
    </WideLayout>
  );
}
