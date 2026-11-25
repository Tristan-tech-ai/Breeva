import { useEffect, useState } from 'react';
import { CircleMarker, GeoJSON, MapContainer, Marker, Polyline, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import BasemapLayer from '../map/VectorBasemap';
import { basemap } from '../../lib/basemap';
import { pm25Category } from '../../lib/ispu';
import type { FirePoint } from '../../lib/nasional/firms';
import { gridPoints, type WindFile } from '../../lib/nasional/angin';

const arrow = (from: number, speed: number) => L.divIcon({
  className: '',
  iconSize: [18, 18],
  // the arrow points where the wind blows TO
  html: `<svg width="18" height="18" viewBox="0 0 18 18" style="transform:rotate(${(from + 180) % 360}deg);opacity:${Math.min(0.9, 0.35 + speed / 12)}"><path d="M9 2 L13 9 H10 V16 H8 V9 H5 Z" fill="#0369a1"/></svg>`,
});

/** N-24: kab/kota polygons coloured by the background PM2.5 now; a tap opens that kab/kota. */
export interface Choropleth { url: string; nilai: Record<string, number | null>; nama: Record<string, string>; onPick: (slug: string) => void }

/** National monitoring map (N-11, N-24): kab/kota colours, fire points of the last 24 hours sized by power, wind arrows. */
export default function PantauMap({ fires, wind, hour = 0, center, zoom, dark, kab, jalur = [], luar = false }: {
  fires: FirePoint[]; wind: WindFile | null; hour?: number; center: [number, number]; zoom: number; dark: boolean; kab?: Choropleth;
  /** N-26: 24-hour smoke paths (lon, lat per hour) */
  jalur?: Array<Array<[number, number]>>;
  /** N-37: points without a kab/kota are fires outside Indonesia, drawn grey */
  luar?: boolean;
}) {
  const pts = gridPoints();
  const [fc, setFc] = useState<GeoJSON.FeatureCollection | null>(null);
  useEffect(() => {
    if (!kab?.url) return;
    let alive = true;
    fetch(kab.url).then((r) => (r.ok ? r.json() : null)).then((j) => alive && setFc(j)).catch(() => {});
    return () => { alive = false; };
  }, [kab?.url]);
  return (
    // the global .leaflet-container rule forces height: 100% !important, so the height lives on this wrapper
    <div className="w-full overflow-hidden rounded-2xl" style={{ height: '26rem' }}>
    <MapContainer center={center} zoom={zoom} minZoom={4} attributionControl scrollWheelZoom={false}
      ref={(m) => { m?.attributionControl.addAttribution('Titik api: <a href="https://firms.modaps.eosdis.nasa.gov">NASA FIRMS</a>; angin dan latar: <a href="https://open-meteo.com">Open-Meteo</a>, CAMS; batas: OpenStreetMap'); }}>
      <BasemapLayer raster={basemap('voyager', dark)} dark={dark} vector />
      {kab && fc && (
        <GeoJSON key={Object.keys(kab.nilai).length} data={fc}
          style={(f) => {
            const v = kab.nilai[(f?.properties as { s: string }).s];
            return { color: '#475569', weight: 0.4, fillColor: v == null ? '#cbd5e1' : pm25Category(v).color, fillOpacity: v == null ? 0.15 : 0.45 };
          }}
          onEachFeature={(f, layer) => {
            const s = (f.properties as { s: string }).s;
            const v = kab.nilai[s];
            layer.bindTooltip(`${kab.nama[s] ?? s}${v == null ? '' : ` · PM2,5 latar ${v.toLocaleString('id-ID', { maximumFractionDigits: 0 })} µg/m³`}`, { sticky: true });
            layer.on('click', () => kab.onPick(s));
          }} />
      )}
      {jalur.map((j, i) => (
        <Polyline key={`j${i}`} positions={j.map(([lon, lat]) => [lat, lon] as [number, number])} pathOptions={{ color: '#7c2d12', weight: 2, opacity: 0.55, dashArray: '4 4' }} interactive={false} />
      ))}
      {wind && pts.map(([lon, lat], k) => {
        const s = wind.speed[k]?.[hour], d = wind.dir[k]?.[hour];
        if (s == null || d == null || s < 0 || d < 0) return null;
        return <Marker key={`w${k}`} position={[lat, lon]} icon={arrow(d, s)} interactive={false} keyboard={false} />;
      })}
      {fires.map((f, i) => (
        <CircleMarker key={i} center={[f[1], f[0]]} radius={Math.min(9, 2.5 + Math.sqrt(Math.max(0, f[2])) / 2)}
          pathOptions={luar && !f[6] ? { color: '#475569', weight: 1, fillColor: '#94a3b8', fillOpacity: 0.7 } : { color: '#b91c1c', weight: 1, fillColor: f[3] === 'h' ? '#dc2626' : '#f97316', fillOpacity: 0.75 }}>
          <Tooltip>{luar && !f[6] ? 'Di luar Indonesia · ' : ''}Titik api {f[4].replace('T', ' ').replace('Z', ' UTC')} · daya {f[2].toLocaleString('id-ID')} MW · keyakinan {({ h: 'tinggi', n: 'sedang', l: 'rendah' } as Record<string, string>)[f[3]] ?? f[3]}</Tooltip>
        </CircleMarker>
      ))}
    </MapContainer>
    </div>
  );
}
