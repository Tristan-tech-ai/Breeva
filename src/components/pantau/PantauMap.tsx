import { memo, useEffect, useState } from 'react';
import { MapContainer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import BasemapLayer from '../map/VectorBasemap';
import { PETA_HEMAT } from '../../lib/mapPerf';
import { basemap } from '../../lib/basemap';
import { pm25Category } from '../../lib/ispu';
import type { FirePoint } from '../../lib/nasional/firms';
import type { WindFile } from '../../lib/nasional/angin';
import { teksCctv, warnaCctv, CCTV_LABEL, type CctvKamera } from '../../lib/nasional/cctv';
import { bentukPanah, gayaApi, opasitasPanah, panahAngin, radiusApi, teksApi, type Panah } from '../../lib/nasional/petaPantau';

/** N-24: kab/kota polygons coloured by the background PM2.5 now; a tap opens that kab/kota. */
export interface Choropleth { url: string; nilai: Record<string, number | null>; nama: Record<string, string>; onPick: (slug: string) => void }

interface Props {
  fires: FirePoint[]; wind: WindFile | null; hour?: number; center: [number, number]; zoom: number; dark: boolean; kab?: Choropleth;
  /** N-26: 24-hour smoke paths (lon, lat per hour) */
  jalur?: Array<Array<[number, number]>>;
  /** N-37: points without a kab/kota are fires outside Indonesia, drawn grey */
  luar?: boolean;
  /** N-27: open and own sensors, drawn blue, never used by the model */
  sensors?: Array<{ lat: number; lon: number; label: string }>;
  /** N-35: traffic cameras (counts only, no picture), contest trial */
  cctv?: CctvKamera[];
}

const EMPTY: never[] = [];

/** Adds the layer `build` makes while the inputs are the same objects; rebuilt only when one of them changes. */
function useLapisan(build: (map: L.Map) => L.Layer | null, deps: unknown[]) {
  const map = useMap();
  useEffect(() => {
    const l = build(map);
    l?.addTo(map);
    return () => { l?.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, ...deps]);
}

function Wilayah({ kab }: { kab: Choropleth }) {
  const [fc, setFc] = useState<GeoJSON.FeatureCollection | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(kab.url).then((r) => (r.ok ? r.json() : null)).then((j) => alive && setFc(j)).catch(() => {});
    return () => { alive = false; };
  }, [kab.url]);
  useLapisan(() => {
    if (!fc) return null;
    // smoothFactor is a polyline option; L.geoJSON hands its options to every polygon it makes
    return L.geoJSON(fc, {
      smoothFactor: 1.5,
      style: (f: GeoJSON.Feature | undefined) => {
        const v = kab.nilai[(f?.properties as { s: string }).s];
        return { color: '#475569', weight: 0.4, fillColor: v == null ? '#cbd5e1' : pm25Category(v).color, fillOpacity: v == null ? 0.15 : 0.45 };
      },
      onEachFeature: (f, layer) => {
        const s = (f.properties as { s: string }).s;
        const v = kab.nilai[s];
        layer.bindTooltip(`${kab.nama[s] ?? s}${v == null ? '' : ` · PM2,5 latar ${v.toLocaleString('id-ID', { maximumFractionDigits: 0 })} µg/m³`}`, { sticky: true });
        layer.on('click', () => kab.onPick(s));
      },
    } as L.GeoJSONOptions);
  }, [fc, kab.nilai, kab.nama, kab.onPick]);
  return null;
}

function Titik({ fires, luar, cctv, sensors, jalur }: { fires: FirePoint[]; luar: boolean; cctv: CctvKamera[]; sensors: NonNullable<Props['sensors']>; jalur: NonNullable<Props['jalur']> }) {
  useLapisan(() => L.layerGroup(jalur.map((j) => L.polyline(j.map(([lon, lat]) => [lat, lon] as [number, number]),
    { color: '#7c2d12', weight: 2, opacity: 0.55, dashArray: '4 4', interactive: false }))), [jalur]);
  useLapisan(() => L.layerGroup(cctv.map((k) => L.circleMarker([k.lat, k.lon], {
    radius: k.status === 'ok' ? Math.min(8, 3.5 + Math.sqrt(k.total ?? 0)) : 3.5, color: '#134e4a', weight: 1, fillColor: warnaCctv(k), fillOpacity: 0.85,
  }).bindTooltip(`${teksCctv(k)} · ${CCTV_LABEL}`))), [cctv]);
  useLapisan(() => L.layerGroup(sensors.map((s) => L.circleMarker([s.lat, s.lon], { radius: 6, color: '#075985', weight: 2, fillColor: '#38bdf8', fillOpacity: 0.85 })
    .bindTooltip(s.label))), [sensors]);
  useLapisan(() => L.layerGroup(fires.map((f) => L.circleMarker([f[1], f[0]], { radius: radiusApi(f), ...gayaApi(f, luar) }).bindTooltip(teksApi(f, luar)))), [fires, luar]);
  return null;
}

/** Wind arrows on their own canvas in screen pixels: hidden during a zoom animation and redrawn once it ends, instead of
 * 384 DOM markers moved on every animation frame. */
class LapisanPanah extends L.Layer {
  private canvas: HTMLCanvasElement | null = null;
  private data: Panah[];
  constructor(data: Panah[]) { super(); this.data = data; }
  onAdd(map: L.Map) {
    this.canvas = L.DomUtil.create('canvas', 'leaflet-zoom-hide');
    this.canvas.style.pointerEvents = 'none';
    map.getPane('overlayPane')!.appendChild(this.canvas);
    map.on('moveend zoomend resize viewreset', this.gambar, this);
    this.gambar();
    return this;
  }
  onRemove(map: L.Map) {
    map.off('moveend zoomend resize viewreset', this.gambar, this);
    this.canvas?.remove();
    this.canvas = null;
    return this;
  }
  setData(data: Panah[]) { this.data = data; this.gambar(); }
  private gambar() {
    const map = (this as unknown as { _map?: L.Map })._map;
    const c = this.canvas;
    if (!map || !c) return;
    const size = map.getSize();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = size.x * dpr; c.height = size.y * dpr;
    c.style.width = `${size.x}px`; c.style.height = `${size.y}px`;
    L.DomUtil.setPosition(c, map.containerPointToLayerPoint([0, 0]));
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size.x, size.y);
    g.strokeStyle = '#0369a1'; g.lineWidth = 2; g.lineCap = 'round'; g.lineJoin = 'round';
    for (const p of this.data) {
      const pt = map.latLngToContainerPoint([p.lat, p.lon]);
      if (pt.x < -20 || pt.y < -20 || pt.x > size.x + 20 || pt.y > size.y + 20) continue;
      g.globalAlpha = opasitasPanah(p.speed);
      g.beginPath();
      bentukPanah(pt.x, pt.y, p.from).forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
    }
    g.globalAlpha = 1;
  }
}

function Angin({ wind, hour }: { wind: WindFile | null; hour: number }) {
  const map = useMap();
  useEffect(() => {
    if (!wind) return;
    const l = new LapisanPanah(panahAngin(wind, hour)).addTo(map);
    return () => { l.remove(); };
  }, [map, wind, hour]);
  return null;
}

/** National monitoring map (N-11, N-24, N-40): kab/kota colours, fires of the last 24 hours sized by power, wind arrows,
 * smoke paths, cameras and sensors, all on one canvas (preferCanvas) so a phone zooms without redrawing thousands of SVG
 * shapes. Memoised: typing in the page's search box does not touch the map. */
function PantauMap({ fires, wind, hour = 0, center, zoom, dark, kab, jalur = EMPTY, luar = false, sensors = EMPTY, cctv = EMPTY }: Props) {
  return (
    // the global .leaflet-container rule forces height: 100% !important, so the height lives on this wrapper
    <div className="w-full overflow-hidden rounded-2xl" style={{ height: '26rem' }} data-peta-pantau>
    <MapContainer center={center} zoom={zoom} minZoom={4} attributionControl scrollWheelZoom={false} preferCanvas {...PETA_HEMAT}
      ref={(m) => { m?.attributionControl.addAttribution('Titik api: <a href="https://firms.modaps.eosdis.nasa.gov">NASA FIRMS</a>; angin dan latar: <a href="https://open-meteo.com">Open-Meteo</a>, CAMS; batas: OpenStreetMap'); }}>
      {/* N-41: raster basemap here; the vector basemap (drawn tile by tile on the main thread) cost 1-2 s per pinch at
          city zoom on a slow phone, and these maps colour areas and points, not roads */}
      <BasemapLayer raster={basemap('voyager', dark)} dark={dark} vector={false} />
      {kab && <Wilayah kab={kab} />}
      <Titik fires={fires} luar={luar} cctv={cctv} sensors={sensors} jalur={jalur} />
      <Angin wind={wind} hour={hour} />
    </MapContainer>
    </div>
  );
}

export default memo(PantauMap);
