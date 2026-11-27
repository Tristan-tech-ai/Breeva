import { useEffect } from 'react';
import L from 'leaflet';
import { fieldBase } from '../../lib/field/source';
import type { FireFile, FirePoint } from '../../lib/nasional/firms';
import { gabungApi, gayaApi, radiusApi, radiusGabung, selGabung, teksApi, teksGabung } from '../../lib/nasional/petaPantau';
import { catatanSekali } from '../../lib/map/catatanSekali';
import { ikonUsulan, kalimatTitik, kmAntara, kotaLapisan, LEGENDA_BUTA, slugButa, slugTerukur, teksTitikKota, usulanUntukZoom, ZOOM_TITIK_KOTA, type DataTitik, type KotaTitik, type Usulan } from '../../lib/sensorTitik';
import { bacaIndeks, type KabKota, type KabKotaIndeks } from '../../lib/nasional/kabkota';

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
 * M-U14 + T9 (Tristan, 27 Nov): where the map is blind and where it is not. Green: kab/kota with a sensor within 25 km,
 * and within 1 km of a pilot sensor. Orange: kab/kota without one, and inside the two pilot regions the 250 m blindness
 * image of /sensor/titik. Filled blue dots: sensors that exist. Hollow dashed markers: proposed sensors, with their rank;
 * zoomed out one marker per city with the count (they sat on top of each other), plus one proposal at the centre of every
 * blind kab/kota (the national top 30 at any zoom, all of them from zoom 8): a sensor there makes it measured.
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
    const penanda = L.layerGroup().addTo(map);
    // M-U18: read once, closed with "Oke"; the symbols also explain themselves on a tap (tooltips and popups)
    const { kontrol: legenda } = catatanSekali('legenda_buta', LEGENDA_BUTA, { posisi: 'bottomleft', atribut: 'data-legenda-buta', lebar: 270 });
    legenda.addTo(map);

    const daftar: Usulan[] = [];
    const pusatKota: Array<{ lat: number; lon: number }> = [];
    const popup = (judul: string, kalimat: string, tautan: string, teksTautan: string) => {
      const isi = document.createElement('div');
      isi.style.maxWidth = '220px';
      const h = document.createElement('p'); h.style.fontWeight = '700'; h.textContent = judul;
      const p = document.createElement('p'); p.style.fontSize = '12px'; p.textContent = kalimat;
      const a = document.createElement('a'); a.href = tautan; a.textContent = teksTautan; a.style.fontSize = '12px';
      isi.append(h, p, a);
      return isi;
    };
    // the proposals for this zoom, only those near the view (a country of DOM markers would slow a phone)
    const gambarPenanda = () => {
      if (batal) return;
      penanda.clearLayers();
      const b = map.getBounds().pad(0.3);
      for (const u of usulanUntukZoom(daftar, map.getZoom())) {
        if (!b.contains([u.lat, u.lon])) continue;
        const besar = u.teks.length > 1 ? 28 : 24;
        const m = L.marker([u.lat, u.lon], {
          title: u.judul,
          icon: L.divIcon({ className: '', iconSize: [besar, besar], iconAnchor: [besar / 2, besar / 2], html: ikonUsulan(u.teks, { ukuran: besar }) }),
        });
        if (u.perbesar) m.on('click', () => map.flyTo([u.lat, u.lon], ZOOM_TITIK_KOTA + 1, { duration: 0.6 }));
        else m.bindPopup(popup(u.judul, u.kalimat, u.tautan, u.teksTautan), { maxWidth: 240 });
        m.addTo(penanda);
      }
    };
    map.on('zoomend moveend', gambarPenanda);

    const pilot = ['badung_denpasar', 'kota_bogor'].map((w) => fetch(`/data/titik_sensor/${w}.json`).then((r) => (r.ok ? r.json() : null)).then((d: DataTitik | null) => {
      if (batal || !d) return;
      const label = w === 'kota_bogor' ? 'Kota Bogor' : 'Badung–Denpasar';
      // green within 1 km of a sensor (the hourly error there is about half that beyond 2 km), under the blindness image
      for (const [lat, lon] of d.sensor) L.circle([lat, lon], { renderer: kanvasKabut, pane: PANE, radius: 1000, stroke: false, fillColor: '#16a34a', fillOpacity: 0.22, interactive: false }).addTo(g);
      // the pilot's own blindness image (250 m cells), as on /sensor/titik
      L.imageOverlay(`/data/titik_sensor/${d.kabut.png}`, d.kabut.bounds, { pane: PANE, opacity: 0.85, interactive: false, className: 'kabut-piksel' }).addTo(g);
      for (const [lat, lon] of d.sensor) {
        L.circleMarker([lat, lon], { renderer: kanvasTitik, radius: 5, color: '#0c4a6e', weight: 1.5, fillColor: '#22d3ee', fillOpacity: 0.95 })
          .bindTooltip('Sensor warga yang ada (dipakai peta)').addTo(g);
      }
      for (const t of d.titik) {
        daftar.push({ lat: t.lat, lon: t.lon, grup: label, peringkat: t.peringkat, nama: t.nama, judul: `Usulan sensor ke-${t.peringkat} di ${label}: ${t.nama}`,
          kalimat: `Belum ada sensor di sini. ${kalimatTitik(t)}`, tautan: `/sensor/titik?wilayah=${w}`, teksTautan: 'Semua usulan dan cara menghitungnya' });
        pusatKota.push({ lat: t.lat, lon: t.lon });
      }
    }).catch(() => { /* file missing: no points */ }));
    // M-T10: the first three proposed points of the ten 2027 cities
    const kota = fetch('/data/titik_sensor/sepuluh_kota.json').then((r) => (r.ok ? r.json() : null)).then((d: { kota?: KotaTitik[] } | null) => {
      if (batal || !d?.kota) return;
      for (const k of kotaLapisan(d.kota)) for (const t of k.titik) {
        const { judul, kalimat } = teksTitikKota(k, t);
        daftar.push({ lat: t.lat, lon: t.lon, grup: k.kota, peringkat: t.peringkat, nama: t.nama, judul, kalimat, tautan: '/sensor/titik', teksTautan: 'Tabel sepuluh kota' });
        pusatKota.push({ lat: t.lat, lon: t.lon });
      }
    }).catch(() => { /* file missing: no city points */ });

    // the country: green where a sensor is within 25 km, orange where none is; and a proposal at every blind kab/kota
    const base = fieldBase();
    type Nasional = { buta: Set<string>; urutan: Map<string, { peringkat: number; alasan?: string }>; kab: KabKota[] };
    const nasional: Promise<Nasional | null> = Promise.all([
      fetch('/data/kabkota_peta_kasar.geojson').then((r) => (r.ok ? r.json() : null)),
      fetch(`${base}/v/nasional/latar.json`).then((r) => (r.ok ? r.json() : null)),
      fetch(`${base}/v/nasional/kabkota_indeks.json`).then((r) => (r.ok ? r.json() : null)),
      fetch(`${base}/v/nasional/butuh_sensor.json`).then((r) => (r.ok ? r.json() : null)),
    ]).then(([fc, latar, indeks, butuh]: [GeoJSON.FeatureCollection | null, { wilayah?: Record<string, { t: string }> } | null, KabKotaIndeks | null, { kabkota?: Array<{ peringkat: number; slug: string; alasan?: string }> } | null]) => {
      if (batal || !fc || !latar?.wilayah) return null;
      const buta = slugButa(latar.wilayah), terukur = slugTerukur(latar.wilayah);
      const slugOf = (f: GeoJSON.Feature) => String((f.properties as { s?: string } | null)?.s);
      // Leaflet hands these options to every polygon it makes: one canvas in the fog pane, no events
      L.geoJSON(fc, { filter: (f) => buta.has(slugOf(f)), renderer: kanvasKabut, pane: PANE, interactive: false, style: { stroke: false, fillColor: '#f97316', fillOpacity: 0.22 } } as L.GeoJSONOptions).addTo(g);
      L.geoJSON(fc, { filter: (f) => terukur.has(slugOf(f)), renderer: kanvasKabut, pane: PANE, interactive: false, style: { stroke: false, fillColor: '#16a34a', fillOpacity: 0.18 } } as L.GeoJSONOptions).addTo(g);
      const urutan = new Map((butuh?.kabkota ?? []).map((k) => [k.slug, k] as const));
      return { buta, urutan, kab: bacaIndeks(indeks) };
    }).catch(() => null);

    // the kab/kota centres wait for the city points, so a centre near a city with its own points is left out
    void Promise.all([...pilot, kota]).then(() => nasional).then((nas) => {
      if (batal) return;
      if (nas) {
        for (const k of nas.kab) {
          if (!nas.buta.has(k.slug)) continue;
          if (pusatKota.some((c) => kmAntara(c, { lat: k.lat, lon: k.lon }) < 20)) continue;
          const u = nas.urutan.get(k.slug);
          daftar.push({ lat: k.lat, lon: k.lon, grup: 'nasional', peringkat: u?.peringkat ?? 999, urutanNasional: u?.peringkat, nama: k.nama,
            judul: u ? `Usulan prioritas nasional ke-${u.peringkat}: ${k.nama}` : `Usulan sensor: ${k.nama}`,
            kalimat: `Belum ada alat ukur dalam 25 km, jadi angka peta di sini perkiraan. Satu sensor di sekitar pusat ${k.nama} menjadikannya terukur.${u?.alasan ? ` ${u.alasan}.` : ''}`,
            tautan: `/pantau/${k.slug}`, teksTautan: 'Lihat kualitas udara kab/kota ini' });
        }
      }
      gambarPenanda();
    });
    return () => { batal = true; map.off('zoomend moveend', gambarPenanda); g.remove(); penanda.remove(); legenda.remove(); };
  }, [map, enabled]);
}
