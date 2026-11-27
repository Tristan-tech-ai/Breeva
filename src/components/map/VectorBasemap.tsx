/**
 * Breeva's vector basemap (F1-68, lib/basemapVector.ts): the national file anywhere in Indonesia (M-U16), offline the
 * saved pilot region's own file; outside Indonesia the muted OpenStreetMap raster (lib/basemap.ts). protomaps-leaflet and
 * the flavours load in their own chunk after the map exists, so the first screen does not wait for them. If the vector
 * basemap cannot load, the raster stays.
 */
import { useEffect, useState } from 'react';
import type L from 'leaflet';
import { TileLayer, useMap, useMapEvents } from 'react-leaflet';
import type { Basemap } from '../../lib/basemap';
import { BASEMAP_ATTRIBUTION, BASEMAP_MAX_DATA_ZOOM, BASEMAP_NATIONAL, basemapFile, basemapUrl, breevaFlavor, pendingTileColor, withoutPoiLabels } from '../../lib/basemapVector';
import { fieldBase } from '../../lib/field/source';
import { readAheadHeader, sharedRangeSource } from '../../lib/cachedRangeSource';
import { dprPetaDasar, UBIN_HEMAT } from '../../lib/mapPerf';

export default function BasemapLayer({ raster, dark, vector }: { raster: Basemap; dark: boolean; vector: boolean }) {
  const map = useMap();
  const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;
  const pilih = () => { const c = map.getCenter(); return basemapFile(c.lat, c.lng, online()); };
  const [region, setRegion] = useState<string | null>(() => (vector ? pilih() : null));
  const [failed, setFailed] = useState(false);
  useMapEvents({ moveend: () => { if (vector) setRegion(pilih()); } });
  // going offline or back: the saved region file takes over, or the national file returns
  useEffect(() => {
    if (!vector) return;
    const ganti = () => setRegion(pilih());
    window.addEventListener('online', ganti); window.addEventListener('offline', ganti);
    return () => { window.removeEventListener('online', ganti); window.removeEventListener('offline', ganti); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vector, map]);

  const useVector = vector && !!region && !failed;
  useEffect(() => {
    if (!useVector || !region) return;
    let layer: L.Layer | null = null;
    let restoreBg: string | null = null;
    let cancelled = false;
    // a region file keeps its ranges in Cache Storage for offline use (X-W40); the national file is read straight from
    // the CDN (the browser's own cache holds what was seen): keeping every range of a country would fill the phone
    const nasional = region === BASEMAP_NATIONAL.name;
    const alamat = basemapUrl(fieldBase(), region);
    const src = nasional ? null : sharedRangeSource(alamat);
    if (src) readAheadHeader(src); // the header downloads while the modules load (X-W51)
    void Promise.all([import('protomaps-leaflet'), import('@protomaps/basemaps'), import('pmtiles')]).then(([pl, pb, pm]) => {
      if (cancelled) return;
      const flavor = breevaFlavor(dark ? pb.DARK : pb.WHITE, dark);
      const l = pl.leafletLayer({
        // ranges kept in Cache Storage by the page itself, also before the service worker controls it (X-W40)
        url: (src ? new pm.PMTiles(src) : new pm.PMTiles(alamat)) as unknown as string,
        paintRules: pl.paintRules(flavor),
        labelRules: withoutPoiLabels(pl.labelRules(flavor, 'id')),
        backgroundColor: flavor.background,
        maxDataZoom: BASEMAP_MAX_DATA_ZOOM,
        attribution: BASEMAP_ATTRIBUTION,
        ...UBIN_HEMAT, // N-41: tiles drawn on the main thread render once the zoom ends
        devicePixelRatio: dprPetaDasar(),
      });
      const gl = l as unknown as L.GridLayer;
      // tiles still loading show the land colour, not Leaflet's grey (X-W56)
      const box = map.getContainer();
      restoreBg = box.style.backgroundColor;
      box.style.backgroundColor = pendingTileColor(flavor);
      gl.addTo(map);
      // under every overlay (the coloured roads and the route live in their own panes)
      gl.setZIndex(0);
      layer = gl;
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      layer?.remove();
      if (restoreBg !== null) map.getContainer().style.backgroundColor = restoreBg;
    };
  }, [useVector, region, dark, map]);

  if (useVector) return null;
  return <TileLayer key={raster.url + (raster.className ?? '')} url={raster.url} attribution={raster.attribution} className={raster.className} {...(raster.subdomains ? { subdomains: raster.subdomains } : {})} {...UBIN_HEMAT} />;
}
