import { AppLayout } from '@/app/AppLayout';
import { ArtOverlays } from '@/app/ArtOverlays';
import { ListColumn } from '@/app/ListColumn';
import { TransportDock } from '@/app/TransportDock';
import { NowPlaying } from '@/features/NowPlaying/NowPlaying';

export function LibraryPage() {
  return (
    <AppLayout art={<NowPlaying />} overlay={<ArtOverlays />} list={<ListColumn />} transport={<TransportDock />} />
  );
}
