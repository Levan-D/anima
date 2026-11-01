import { AppLayout } from '@/app/AppLayout';
import { ArtOverlays } from '@/app/ArtOverlays';
import { ListColumn } from '@/app/ListColumn';
import { NowPlaying } from '@/features/NowPlaying/NowPlaying';
import { Transport } from '@/features/Transport/Transport';

export function LibraryPage() {
  return <AppLayout art={<NowPlaying />} overlay={<ArtOverlays />} list={<ListColumn />} transport={<Transport />} />;
}
