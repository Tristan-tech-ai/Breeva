import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import BasemapLayer from '../map/VectorBasemap';
import { PETA_HEMAT } from '../../lib/mapPerf';
import { basemap } from '../../lib/basemap';
import { pm25Category } from '../../lib/ispu';
import { formatAngka } from '../../lib/angka';
import type { FirePoint } from '../../lib/nasional/firms';
import type { WindFile } from '../../lib/nasional/angin';
import { teksCctv, warnaCctv, CCTV_LABEL, type CctvKamera } from '../../lib/nasional/cctv';
import { bentukPanah, gabungApi, gayaApi, opasitasPanah, panahAngin, radiusApi, radiusGabung, selGabung, teksApi, teksGabung, type Panah } from '../../lib/nasional/petaPantau';

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

/** After the page has painted (the map layers are not built inside React's render task, N-42). */
const sesudahLukis = (fn: () => void) => { let t = 0; const r = requestAnimationFrame(() => { t = window.setTimeout(fn, 0); }); return () => { cancelAnimationFrame(r); clearTimeout(t); }; };
type Berfitur = L.Layer & { feature?: GeoJSON.Feature };

function Wilayah({ kab }: { kab: Choropleth }) {
  const map = useMap();
  const [fc, setFc] = useState<GeoJSON.FeatureCollection | null>(null);
  const [lapisan, setLapisan] = useState<L.GeoJSON | null>(null);
  const kabRef = useRef(kab);
  useEffect(() => { kabRef.current = kab; }, [kab]);
  useEffect(() => {
    let alive = true;
    fetch(kab.url).then((r) => (r.ok ? r.json() : null)).then((j) => alive && setFc(j)).catch(() => {});
    return () => { alive = false; };
  }, [kab.url]);
  // N-42: 513 polygons added 80 per task after the first paint; one tooltip and one click handler on the group (the
  // text is made when a polygon is hovered), instead of 513 tooltips built while the page loads
  useEffect(() => {
    if (!fc) return;
    const gaya = (f: GeoJSON.Feature | undefined) => {
      const v = kabRef.current.nilai[(f?.properties as { s: string }).s];
      return { color: '#475569', weight: 0.4, fillColor: v == null ? '#cbd5e1' : pm25Category(v).color, fillOpacity: v == null ? 0.15 : 0.45 };
    };
    // smoothFactor is a polyline option; L.geoJSON hands its options to every polygon it makes
    const g = L.geoJSON(undefined, { smoothFactor: 1.5, style: gaya } as L.GeoJSONOptions);
    g.bindTooltip((l) => {
      const s = ((l as Berfitur).feature?.properties as { s: string } | undefined)?.s ?? '';
      const v = kabRef.current.nilai[s];
      return `${kabRef.current.nama[s] ?? s}${v == null ? '' : ` · PM2,5 latar ${formatAngka(v, 0, 0)} µg/m³`}`;
    }, { sticky: true });
    g.on('click', (e) => { const s = ((e.propagatedFrom as Berfitur | undefined)?.feature?.properties as { s: string } | undefined)?.s; if (s) kabRef.current.onPick(s); });
    g.addTo(map);
    setLapisan(g);
    let i = 0, batal = () => {};
    const langkah = () => {
      const end = Math.min(fc.features.length, i + 80);
      g.addData({ type: 'FeatureCollection', features: fc.features.slice(i, end) } as GeoJSON.FeatureCollection);
      i = end;
      if (i < fc.features.length) batal = sesudahLukis(langkah);
    };
    batal = sesudahLukis(langkah);
    return () => { batal(); g.remove(); setLapisan(null); };
  }, [fc, map]);
  // new background values recolour the polygons in place
  useEffect(() => { lapisan?.setStyle((f) => {
    const v = kab.nilai[(f?.properties as { s: string }).s];
    return { color: '#475569', weight: 0.4, fillColor: v == null ? '#cbd5e1' : pm25Category(v).color, fillOpacity: v == null ? 0.15 : 0.45 };
  }); }, [lapisan, kab.nilai]);
  return null;
}

function Titik({ fires, luar, cctv, sensors, jalur }: { fires: FirePoint[]; luar: boolean; cctv: CctvKamera[]; sensors: NonNullable<Props['sensors']>; jalur: NonNullable<Props['jalur']> }) {
  const map = useMap();
  // M-U04: points on their own canvas, hidden while a zoom gesture runs (Leaflet scales a canvas during the pinch, so the
  // circles grew and every frame repainted them) and drawn once at the new zoom
  const renderer = useMemo(() => L.canvas({ padding: 0.3 }), []);
  const [ukuranSel, setUkuranSel] = useState(() => selGabung(map.getZoom()));
  useEffect(() => {
    const el = () => (renderer as unknown as { _container?: HTMLElement })._container;
    const mulai = () => { const c = el(); if (c) c.style.visibility = 'hidden'; };
    const selesai = () => { const c = el(); if (c) c.style.visibility = ''; setUkuranSel(selGabung(map.getZoom())); };
    map.on('zoomstart', mulai); map.on('zoomend', selesai);
    return () => { map.off('zoomstart', mulai); map.off('zoomend', selesai); };
  }, [map, renderer]);
  const sel = useMemo(() => (ukuranSel == null ? null : gabungApi(fires, ukuranSel)), [fires, ukuranSel]);
  // objects on the point canvas, for the in-page meter (?ukur=1)
  useEffect(() => { (window as unknown as { __pantauObjek?: number }).__pantauObjek = (sel ? sel.length : fires.length) + cctv.length + sensors.length; }, [sel, fires, cctv, sensors]);
  // tooltip texts are made when a point is hovered (functions), not for every point while the page loads (N-42)
  useLapisan(() => L.layerGroup(jalur.map((j) => L.polyline(j.map(([lon, lat]) => [lat, lon] as [number, number]),
    { color: '#7c2d12', weight: 2, opacity: 0.55, dashArray: '4 4', interactive: false }))), [jalur]);
  useLapisan(() => L.layerGroup(cctv.map((k) => L.circleMarker([k.lat, k.lon], {
    renderer, radius: k.status === 'ok' ? Math.min(8, 3.5 + Math.sqrt(k.total ?? 0)) : 3.5, color: '#134e4a', weight: 1, fillColor: warnaCctv(k), fillOpacity: 0.85,
  }).bindTooltip(() => `${teksCctv(k)} · ${CCTV_LABEL}`))), [cctv, renderer]);
  useLapisan(() => L.layerGroup(sensors.map((s) => L.circleMarker([s.lat, s.lon], { renderer, radius: 6, color: '#075985', weight: 2, fillColor: '#38bdf8', fillOpacity: 0.85 })
    .bindTooltip(s.label))), [sensors, renderer]);
  useLapisan(() => sel ? L.layerGroup(sel.map((g) => L.circleMarker([g.lat, g.lon], { renderer, radius: radiusGabung(g.n), color: g.luar && luar ? '#475569' : '#b91c1c', weight: 1,
    fillColor: g.luar && luar ? '#94a3b8' : g.tinggi ? '#dc2626' : '#f97316', fillOpacity: 0.75 }).bindTooltip(() => teksGabung(g)))) : null, [luar, sel, renderer]);
  // every fire (zoom 8 and closer): added 120 per frame after paint, so no single task builds 1,883 layers (M-U04)
  useEffect(() => {
    if (sel) return;
    const g = L.layerGroup().addTo(map);
    let i = 0, batal = () => {};
    const langkah = () => {
      const end = Math.min(fires.length, i + 120);
      for (; i < end; i++) { const f = fires[i]; L.circleMarker([f[1], f[0]], { renderer, radius: radiusApi(f), ...gayaApi(f, luar) }).bindTooltip(() => teksApi(f, luar)).addTo(g); }
      if (i < fires.length) batal = sesudahLukis(langkah);
    };
    batal = sesudahLukis(langkah);
    return () => { batal(); g.remove(); };
  }, [map, fires, luar, sel, renderer]);
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
