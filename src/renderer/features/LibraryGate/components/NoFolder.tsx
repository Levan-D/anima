import { Button } from '@/components/ui/Button';
import { GateScreen } from '@/features/LibraryGate/components/GateScreen';
import { useChooseFolder } from '@/lib/libraryActions';

export function NoFolder() {
  const chooseFolder = useChooseFolder();

  return (
    <GateScreen title="Point me at your music" titleVariant="display">
      <Button variant="primary" size="xl" onClick={() => chooseFolder.mutate()}>
        Choose a folder
      </Button>
    </GateScreen>
  );
}
