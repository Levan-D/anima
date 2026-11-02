import { useQuery } from '@tanstack/react-query';
import { EQ_DEFAULT_LAYERS, type EqLayers } from '@shared/domain';
import { call } from '@/lib/api';
import { settingsQuery } from '@/lib/libraryQueries';

/** Which of the chart's layers are showing, remembered in this machine's settings. */
export function useEqLayers() {
  const { data: layers = EQ_DEFAULT_LAYERS } = useQuery({ ...settingsQuery, select: ({ eqShownLayers }) => eqShownLayers });

  function setLayer(layer: keyof EqLayers, isOn: boolean): void {
    void call('settings.update', { eqShownLayers: { ...layers, [layer]: isOn } });
  }

  return { layers, setLayer };
}
