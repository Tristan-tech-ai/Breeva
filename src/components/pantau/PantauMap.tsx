import { CircleMarker, MapContainer, Marker, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import BasemapLayer from '../map/VectorBasemap';
import { basemap } from '../../lib/basemap';
import type { FirePoint } from '../../lib/nasional/firms';
import { gridPoints, type WindFile } from '../../lib/nasional/angin';

const arrow = (from: number, speed: number) => L.divIcon({
  className: '',
  iconSize: [18, 18],
  // the arrow points where the wind blows TO
  html: `<svg width="18" height="18" viewBox="0 0 18 18" style="transform:rotate(${(from + 180) % 360}deg);opacity:${Math.min(0.9, 0.35 + speed / 12)}"><path d="M9 2 L13 9 H10 V16 H8 V9 H5 Z" fill="#0369a1"/></svg>`,
});

/** National monitoring map (N-11): fire points of the last 24 hours sized by power, and wind arrows for the current hour. */
export default function PantauMap({ fires, wind, hour = 0, center, zoom, dark }: {
  fires: FirePoint[]; wind: WindFile | null; hour?: number; center: [number, number]; zoom: number; dark: boolean;
}) {
  const pts = gridPoints();
  return (
    <MapContainer center={center} zoom={zoom} minZoom={4} className="h-[26rem] w-full rounded-2xl" attributionControl scrollWheelZoom={false}
      ref={(m) => { m?.attributionControl.addAttribution('Titik api: <a href="https://firms.modaps.eosdis.nasa.gov">NASA FIRMS</a>; angin: <a href="https://open-meteo.com">Open-Meteo</a>'); }}>
      <BasemapLayer raster={basemap('voyager', dark)} dark={dark} vector />
      {wind && pts.map(([lon, lat], k) => {
        const s = wind.speed[k]?.[hour], d = wind.dir[k]?.[hour];
        if (s == null || d == null || s < 0 || d < 0) return null;
        return <Marker key={`w${k}`} position={[lat, lon]} icon={arrow(d, s)} interactive={false} keyboard={false} />;
      })}
      {fires.map((f, i) => (
        <CircleMarker key={i} center={[f[1], f[0]]} radius={Math.min(9, 2.5 + Math.sqrt(Math.max(0, f[2])) / 2)}
          pathOptions={{ color: '#b91c1c', weight: 1, fillColor: f[3] === 'h' ? '#dc2626' : '#f97316', fillOpacity: 0.75 }}>
          <Tooltip>Titik api {f[4].replace('T', ' ').replace('Z', ' UTC')} · daya {f[2].toLocaleString('id-ID')} MW · keyakinan {({ h: 'tinggi', n: 'sedang', l: 'rendah' } as Record<string, string>)[f[3]] ?? f[3]}</Tooltip>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
