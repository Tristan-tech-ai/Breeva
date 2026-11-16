import { useEffect } from 'react';
import type L from 'leaflet';

/** Shows `text` in the map's attribution control while `enabled` (licence notices for the active data layers). */
export function useMapAttribution(map: L.Map | null, text: string, enabled: boolean): void {
  useEffect(() => {
    const ctl = map?.attributionControl;
    if (!ctl || !enabled) return;
    ctl.addAttribution(text);
    return () => { ctl.removeAttribution(text); };
  }, [map, text, enabled]);
}
