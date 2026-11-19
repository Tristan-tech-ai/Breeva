/**
 * Breeva's vector basemap inside a field region (F1-68, lib/basemapVector.ts); elsewhere the muted OpenStreetMap raster
 * (lib/basemap.ts). protomaps-leaflet and the flavours load in their own chunk after the map exists, so the first
 * screen does not wait for them. If the vector basemap cannot load, the raster stays.
 */
import { useEffect, useState } from 'react';
import type L from 'leaflet';
import { TileLayer, useMap, useMapEvents } from 'react-leaflet';
import type { Basemap } from '../../lib/basemap';
import { BASEMAP_ATTRIBUTION, BASEMAP_MAX_DATA_ZOOM, basemapRegion, basemapUrl, breevaFlavor, withoutPoiLabels } from '../../lib/basemapVector';
import { fieldBase } from '../../lib/field/source';
import { CachedRangeSource } from '../../lib/cachedRangeSource';

export default function BasemapLayer({ raster, dark, vector }: { raster: Basemap; dark: boolean; vector: boolean }) {
  const map = useMap();
  const [region, setRegion] = useState<string | null>(() => (vector ? basemapRegion(map.getCenter().lat, map.getCenter().lng) : null));
  const [failed, setFailed] = useState(false);
  useMapEvents({
    moveend: () => {
      if (!vector) return;
      const c = map.getCenter();
      setRegion(basemapRegion(c.lat, c.lng));
    },
  });

  const useVector = vector && !!region && !failed;
  useEffect(() => {
    if (!useVector || !region) return;
    let layer: L.Layer | null = null;
    let cancelled = false;
    void Promise.all([import('protomaps-leaflet'), import('@protomaps/basemaps'), import('pmtiles')]).then(([pl, pb, pm]) => {
      if (cancelled) return;
      const flavor = breevaFlavor(dark ? pb.DARK : pb.WHITE, dark);
      const l = pl.leafletLayer({
        // ranges kept in Cache Storage by the page itself, also before the service worker controls it (X-W40)
        url: new pm.PMTiles(new CachedRangeSource(basemapUrl(fieldBase(), region))) as unknown as string,
        paintRules: pl.paintRules(flavor),
        labelRules: withoutPoiLabels(pl.labelRules(flavor, 'id')),
        backgroundColor: flavor.background,
        maxDataZoom: BASEMAP_MAX_DATA_ZOOM,
        attribution: BASEMAP_ATTRIBUTION,
      });
      const gl = l as unknown as L.GridLayer;
      gl.addTo(map);
      // under every overlay (the coloured roads and the route live in their own panes)
      gl.setZIndex(0);
      layer = gl;
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; layer?.remove(); };
  }, [useVector, region, dark, map]);

  if (useVector) return null;
  return <TileLayer key={raster.url + (raster.className ?? '')} url={raster.url} attribution={raster.attribution} className={raster.className} {...(raster.subdomains ? { subdomains: raster.subdomains } : {})} />;
}
