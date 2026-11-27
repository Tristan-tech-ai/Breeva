import { useEffect } from 'react';
import L from 'leaflet';
import { fieldBase } from '../../lib/field/source';
import type { FireFile, FirePoint } from '../../lib/nasional/firms';
import { gabungApi, gayaApi, radiusApi, radiusGabung, selGabung, teksApi, teksGabung } from '../../lib/nasional/petaPantau';
import { ikonUsulan, kalimatTitik, kotaLapisan, LEGENDA_BUTA, slugButa, teksTitikKota, type DataTitik, type KotaTitik } from '../../lib/sensorTitik';

/**
 * M-U07: two optional layers of the in-app map. Fires of the last 24 hours (NASA FIRMS, the /pantau file), merged per cell
 * when zoomed out and drawn on their own canvas that hides during a zoom gesture (as /pantau, M-U04); and the blind areas of
 * the map with the proposed sensor points (M-U14).
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

/**
 * M-U14 (Tristan, 27 Nov): the layer shows where the map is BLIND, not pins that read as stations. Orange areas: kab/kota
 * without a sensor within 25 km (the national levels of /pantau), and inside the two pilot regions the 250 m blindness
 * image of /sensor/titik. Filled blue dots: sensors that exist. Hollow dashed plus: a proposed sensor point.
 */
export function useTitikSensorPeta(map: L.Map | null, enabled: boolean) {
  useEffect(() => {
    if (!map || !enabled) return;
    let batal = false;
    // under the coloured roads and every marker, and never in the way of a tap
    const PANE = 'kabutButa';
    if (!map.getPane(PANE)) {
      // beside the tile and overlay panes (with leaflet-rotate both live in rotatePane): a pane made on the map pane itself
      // ends up under the basemap
      const pane = map.createPane(PANE, map.getPane('rotatePane') ?? undefined);
      pane.style.zIndex = '350'; pane.style.pointerEvents = 'none';
    }
    const kanvasKabut = L.canvas({ pane: PANE, padding: 0.3 });
    const kanvasTitik = L.canvas({ padding: 0.3 });
    const g = L.layerGroup().addTo(map);
    const legenda = new L.Control({ position: 'bottomleft' });
    legenda.onAdd = () => {
      const d = L.DomUtil.create('div');
      d.setAttribute('data-legenda-buta', '');
      d.style.cssText = 'max-width:230px;background:rgba(255,255,255,.95);color:#1f2937;border-radius:10px;padding:6px 8px;font:500 11px/1.35 system-ui;box-shadow:0 1px 3px rgba(0,0,0,.2)';
      d.textContent = LEGENDA_BUTA;
      return d;
    };
    legenda.addTo(map);

    // the country: kab/kota without a measurement nearby, as one quiet orange wash
    Promise.all([
      fetch('/data/kabkota_peta_kasar.geojson').then((r) => (r.ok ? r.json() : null)),
      fetch(`${fieldBase()}/v/nasional/latar.json`).then((r) => (r.ok ? r.json() : null)),
    ]).then(([fc, latar]: [GeoJSON.FeatureCollection | null, { wilayah?: Record<string, { t: string }> } | null]) => {
      if (batal || !fc || !latar?.wilayah) return;
      const buta = slugButa(latar.wilayah);
      // Leaflet hands these options to every polygon it makes: one canvas in the fog pane, no events
      L.geoJSON(fc, {
        filter: (f) => buta.has(String((f.properties as { s?: string } | null)?.s)),
        renderer: kanvasKabut, pane: PANE, interactive: false,
        style: { stroke: false, fillColor: '#f97316', fillOpacity: 0.22 },
      } as L.GeoJSONOptions).addTo(g);
    }).catch(() => { /* offline: the pilot images below still show */ });

    const popup = (judul: string, kalimat: string, tautan: string, teksTautan: string) => {
      const isi = document.createElement('div');
      isi.style.maxWidth = '220px';
      const h = document.createElement('p'); h.style.fontWeight = '700'; h.textContent = judul;
      const p = document.createElement('p'); p.style.fontSize = '12px'; p.textContent = kalimat;
      const a = document.createElement('a'); a.href = tautan; a.textContent = teksTautan; a.style.fontSize = '12px';
      isi.append(h, p, a);
      return isi;
    };
    const usulan = (lat: number, lon: number, judul: string, isi: HTMLElement) => L.marker([lat, lon], {
      title: judul,
      icon: L.divIcon({ className: '', iconSize: [24, 24], iconAnchor: [12, 12], html: ikonUsulan('+') }),
    }).bindPopup(isi, { maxWidth: 240 }).addTo(g);

    for (const w of ['badung_denpasar', 'kota_bogor']) {
      fetch(`/data/titik_sensor/${w}.json`).then((r) => (r.ok ? r.json() : null)).then((d: DataTitik | null) => {
        if (batal || !d) return;
        // the pilot's own blindness image (250 m cells), as on /sensor/titik
        L.imageOverlay(`/data/titik_sensor/${d.kabut.png}`, d.kabut.bounds, { pane: PANE, opacity: 0.85, interactive: false, className: 'kabut-piksel' }).addTo(g);
        for (const [lat, lon] of d.sensor) {
          L.circleMarker([lat, lon], { renderer: kanvasTitik, radius: 5, color: '#0c4a6e', weight: 1.5, fillColor: '#22d3ee', fillOpacity: 0.95 })
            .bindTooltip('Sensor warga yang ada (dipakai peta)').addTo(g);
        }
        for (const t of d.titik) {
          const judul = `Usulan sensor ke-${t.peringkat}: ${t.nama}`;
          usulan(t.lat, t.lon, judul, popup(judul, `Belum ada sensor di sini. ${kalimatTitik(t)}`, `/sensor/titik?wilayah=${w}`, 'Semua usulan dan cara menghitungnya'));
        }
      }).catch(() => { /* file missing: no points */ });
    }
    // M-T10: the first three proposed points of the ten 2027 cities
    fetch('/data/titik_sensor/sepuluh_kota.json').then((r) => (r.ok ? r.json() : null)).then((d: { kota?: KotaTitik[] } | null) => {
      if (batal || !d?.kota) return;
      for (const k of kotaLapisan(d.kota)) for (const t of k.titik) {
        const { judul, kalimat } = teksTitikKota(k, t);
        usulan(t.lat, t.lon, judul, popup(judul, kalimat, '/sensor/titik', 'Tabel sepuluh kota'));
      }
    }).catch(() => { /* file missing: no city points */ });
    return () => { batal = true; g.remove(); legenda.remove(); };
  }, [map, enabled]);
}
