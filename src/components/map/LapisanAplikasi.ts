import { useEffect } from 'react';
import L from 'leaflet';
import { fieldBase } from '../../lib/field/source';
import type { FireFile, FirePoint } from '../../lib/nasional/firms';
import { gabungApi, gayaApi, radiusApi, radiusGabung, selGabung, teksApi, teksGabung } from '../../lib/nasional/petaPantau';
import { kalimatTitik, kotaLapisan, teksTitikKota, type DataTitik, type KotaTitik } from '../../lib/sensorTitik';

/**
 * M-U07: two optional layers of the in-app map. Fires of the last 24 hours (NASA FIRMS, the /pantau file), merged per cell
 * when zoomed out and drawn on their own canvas that hides during a zoom gesture (as /pantau, M-U04); and the next sensor
 * points of the pilot regions (/sensor/titik) as small numbered pins with a short popup.
 */
export function useTitikApiPeta(map: L.Map | null, enabled: boolean) {
  useEffect(() => {
    if (!map || !enabled) return;
    let batal = false;
    const renderer = L.canvas({ padding: 0.3 });
    const g = L.layerGroup().addTo(map);
    let fires: FirePoint[] = [];
    const gambar = () => {
      g.clearLayers();
      const sel = selGabung(map.getZoom());
      if (sel != null) {
        for (const c of gabungApi(fires, sel)) L.circleMarker([c.lat, c.lon], { renderer, radius: radiusGabung(c.n), color: '#b91c1c', weight: 1, fillColor: c.tinggi ? '#dc2626' : '#f97316', fillOpacity: 0.75 }).bindTooltip(() => teksGabung(c)).addTo(g);
      } else {
        const b = map.getBounds().pad(0.3);
        for (const f of fires) if (b.contains([f[1], f[0]])) L.circleMarker([f[1], f[0]], { renderer, radius: radiusApi(f), ...gayaApi(f, false) }).bindTooltip(() => teksApi(f, false)).addTo(g);
      }
    };
    const el = () => (renderer as unknown as { _container?: HTMLElement })._container;
    const mulai = () => { const c = el(); if (c) c.style.visibility = 'hidden'; };
    const selesai = () => { const c = el(); if (c) c.style.visibility = ''; gambar(); };
    map.on('zoomstart', mulai); map.on('zoomend moveend', selesai);
    fetch(`${fieldBase()}/v/nasional/titik_api.json`).then((r) => (r.ok ? r.json() : null)).then((d: FireFile | null) => {
      if (batal || !d) return;
      fires = d.points ?? [];
      gambar();
    }).catch(() => { /* offline: no fire layer */ });
    return () => { batal = true; map.off('zoomstart', mulai); map.off('zoomend moveend', selesai); g.remove(); };
  }, [map, enabled]);
}

export function useTitikSensorPeta(map: L.Map | null, enabled: boolean) {
  useEffect(() => {
    if (!map || !enabled) return;
    let batal = false;
    const g = L.layerGroup().addTo(map);
    for (const w of ['badung_denpasar', 'kota_bogor']) {
      fetch(`/data/titik_sensor/${w}.json`).then((r) => (r.ok ? r.json() : null)).then((d: DataTitik | null) => {
        if (batal || !d) return;
        for (const t of d.titik) {
          const isi = document.createElement('div');
          isi.style.maxWidth = '220px';
          const h = document.createElement('p'); h.style.fontWeight = '700'; h.textContent = `Titik sensor ${t.peringkat}: ${t.nama}`;
          const p = document.createElement('p'); p.style.fontSize = '12px'; p.textContent = kalimatTitik(t);
          const a = document.createElement('a'); a.href = `/sensor/titik?wilayah=${w}`; a.textContent = 'Semua titik dan cara menghitungnya'; a.style.fontSize = '12px';
          isi.append(h, p, a);
          L.marker([t.lat, t.lon], {
            title: `Titik sensor ${t.peringkat}: ${t.nama}`,
            icon: L.divIcon({ className: '', iconSize: [22, 22], iconAnchor: [11, 11],
              html: `<span aria-hidden="true" style="display:block;width:22px;height:22px;border-radius:9999px;border:2px solid #fff;background:#15803d;color:#fff;font:700 11px/18px system-ui;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.35)">${t.peringkat}</span>` }),
          }).bindPopup(isi, { maxWidth: 240 }).addTo(g);
        }
      }).catch(() => { /* file missing: no points */ });
    }
    // M-T10: the first three points of the ten 2027 cities (blue, to tell them from the pilot points)
    fetch('/data/titik_sensor/sepuluh_kota.json').then((r) => (r.ok ? r.json() : null)).then((d: { kota?: KotaTitik[] } | null) => {
      if (batal || !d?.kota) return;
      for (const k of kotaLapisan(d.kota)) for (const t of k.titik) {
        const { judul, kalimat } = teksTitikKota(k, t);
        const isi = document.createElement('div');
        isi.style.maxWidth = '220px';
        const h = document.createElement('p'); h.style.fontWeight = '700'; h.textContent = judul;
        const p = document.createElement('p'); p.style.fontSize = '12px'; p.textContent = kalimat;
        const a = document.createElement('a'); a.href = '/sensor/titik'; a.textContent = 'Tabel sepuluh kota'; a.style.fontSize = '12px';
        isi.append(h, p, a);
        L.marker([t.lat, t.lon], {
          title: judul,
          icon: L.divIcon({ className: '', iconSize: [22, 22], iconAnchor: [11, 11],
            html: `<span aria-hidden="true" style="display:block;width:22px;height:22px;border-radius:9999px;border:2px solid #fff;background:#0369a1;color:#fff;font:700 11px/18px system-ui;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.35)">${t.peringkat}</span>` }),
        }).bindPopup(isi, { maxWidth: 240 }).addTo(g);
      }
    }).catch(() => { /* file missing: no city points */ });
    return () => { batal = true; g.remove(); };
  }, [map, enabled]);
}
