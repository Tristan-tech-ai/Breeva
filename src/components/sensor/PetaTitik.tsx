import { memo, useEffect, useMemo } from 'react';
import { MapContainer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import BasemapLayer from '../map/VectorBasemap';
import { PETA_HEMAT } from '../../lib/mapPerf';
import { basemap } from '../../lib/basemap';
import { lipatAtribusi } from '../../lib/map/lipatAtribusi';
import { ikonUsulan, type DataTitik } from '../../lib/sensorTitik';

/** M-T06: the blindness fog (250 m cells), the sensors that exist (filled blue), and the ranked proposed points as
 * hollow dashed numbers (M-U14: a filled pin read as a station that exists). */
function Lapisan({ data, pilih, onPilih }: { data: DataTitik; pilih: number | null; onPilih: (n: number) => void }) {
  const map = useMap();
  const renderer = useMemo(() => L.canvas({ padding: 0.3 }), []);
  useEffect(() => lipatAtribusi(map), [map]);
  useEffect(() => {
    map.attributionControl.addAttribution('Kebutaan: Breeva (kriging sensor OpenAQ, bangunan OpenStreetMap, sekolah dan faskes OSM)');
    const g = L.layerGroup().addTo(map);
    // one image instead of thousands of cell rectangles (a slow phone re-projects every layer on each zoom, M-U04)
    L.imageOverlay(`/data/titik_sensor/${data.kabut.png}`, data.kabut.bounds, { opacity: 1, interactive: false, className: 'kabut-piksel' }).addTo(g);
    for (const [lat, lon] of data.sensor) L.circleMarker([lat, lon], { renderer, radius: 5, color: '#0c4a6e', weight: 1.5, fillColor: '#22d3ee', fillOpacity: 0.95, interactive: false }).addTo(g);
    map.fitBounds(L.latLngBounds(data.kabut.bounds), { padding: [8, 8] });
    return () => { g.remove(); };
  }, [map, data, renderer]);
  useEffect(() => {
    const g = L.layerGroup().addTo(map);
    for (const t of data.titik) {
      const aktif = pilih === t.peringkat;
      // Leaflet makes the marker itself the button (role, tabindex, keyboard); the number inside is plain text
      L.marker([t.lat, t.lon], {
        title: `Usulan sensor ke-${t.peringkat}: ${t.nama}`,
        icon: L.divIcon({ className: '', iconSize: [28, 28], iconAnchor: [14, 14], html: ikonUsulan(String(t.peringkat), { ukuran: 28, aktif }) }),
        zIndexOffset: aktif ? 1000 : 0,
      }).on('click', () => onPilih(t.peringkat)).addTo(g);
    }
    return () => { g.remove(); };
  }, [map, data, pilih, onPilih]);
  return null;
}

function PetaTitik({ data, dark, pilih, onPilih }: { data: DataTitik; dark: boolean; pilih: number | null; onPilih: (n: number) => void }) {
  const [[s0, w0], [n0, e0]] = data.kabut.bounds;
  const c = [(s0 + n0) / 2, (w0 + e0) / 2];
  return (
    <div className="w-full overflow-hidden rounded-2xl" style={{ height: 'min(60svh, 520px)' }} data-peta-titik>
      <MapContainer center={[c[0], c[1]]} zoom={11} minZoom={9} attributionControl scrollWheelZoom={false} preferCanvas {...PETA_HEMAT}>
        <BasemapLayer raster={basemap('voyager', dark)} dark={dark} vector={false} />
        <Lapisan data={data} pilih={pilih} onPilih={onPilih} />
      </MapContainer>
    </div>
  );
}

export default memo(PetaTitik);
