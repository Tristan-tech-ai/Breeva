// Small lazy-loaded Leaflet picker for the contribution form. Kept out of the main
// /contribute chunk via React.lazy. Uses a divIcon pin (no marker-asset path issues)
// + click-to-move + drag. The coords are the source of truth; this is an affordance
// over the geolocation fix, so the form still works if the map fails to load.
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const PIN = L.divIcon({
  className: '',
  iconSize: [32, 32],
  iconAnchor: [16, 30],
  html:
    '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))">' +
    '<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="#10b981" stroke="#fff" stroke-width="1.6"/>' +
    '<circle cx="12" cy="9" r="2.6" fill="#fff"/></svg>',
});

function ClickCapture({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click(e) { onPick(e.latlng.lat, e.latlng.lng); } });
  return null;
}

export default function LocationPicker({
  lat, lng, onChange,
}: {
  lat: number;
  lng: number;
  onChange: (lat: number, lng: number) => void;
}) {
  return (
    <MapContainer
      center={[lat, lng]}
      zoom={16}
      style={{ height: 168, width: '100%', borderRadius: 14 }}
      scrollWheelZoom={false}
      attributionControl={false}
    >
      <TileLayer url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" />
      <ClickCapture onPick={onChange} />
      <Marker
        position={[lat, lng]}
        draggable
        icon={PIN}
        eventHandlers={{
          dragend(e) {
            const p = (e.target as L.Marker).getLatLng();
            onChange(p.lat, p.lng);
          },
        }}
      />
    </MapContainer>
  );
}
