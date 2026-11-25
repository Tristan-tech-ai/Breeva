import { describe, expect, it, vi } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { cariWilayah, indexWilayah, perProvinsi, PROVINSI, tandaiWilayah, type WilayahFC } from '../src/lib/nasional/wilayah';
import type { FirePoint } from '../src/lib/nasional/firms';
import { JENIS_LAPOR, kirimLaporan, laporBody, perangkatId, teksLapor, totalRingkas, ambilRingkas } from '../src/lib/lapor';
import LaporSheet from '../src/components/lapor/LaporSheet';

const sq = (w: number, s: number, e: number, n: number) => [[w, s], [e, s], [e, n], [w, n], [w, s]];
const FC: WilayahFC = {
  type: 'FeatureCollection',
  features: [
    { properties: { slug: 'kota-a', nama: 'Kota A', provinsi: 'Bali', iso: 'ID-BA', pusat: [115.2, -8.6], luas_km2: 1 },
      geometry: { type: 'Polygon', coordinates: [sq(115, -9, 116, -8), sq(115.4, -8.6, 115.6, -8.4)] } }, // with a hole
    { properties: { slug: 'kabupaten-b', nama: 'Kabupaten B', provinsi: 'Jawa Barat', iso: 'ID-JB', pusat: [106.8, -6.6], luas_km2: 1 },
      geometry: { type: 'MultiPolygon', coordinates: [[sq(106, -7, 107, -6)], [sq(108, -7, 108.5, -6.5)]] } },
  ],
};
const fp = (lon: number, lat: number): FirePoint => [lon, lat, 5, 'n', '2026-11-25T05:00Z', 'N20'];

describe('N-23 kab/kota lookup', () => {
  const idx = indexWilayah(FC);
  it('finds the kab/kota, respects holes and multipolygons, and returns null outside', () => {
    expect(cariWilayah(idx, 115.2, -8.8)?.slug).toBe('kota-a');
    expect(cariWilayah(idx, 115.5, -8.5)).toBeNull(); // inside the hole
    expect(cariWilayah(idx, 108.2, -6.7)?.slug).toBe('kabupaten-b'); // second part of a multipolygon
    expect(cariWilayah(idx, 103.3, 5.3)).toBeNull(); // Terengganu, Malaysia
  });
  it('keeps only Indonesian fire points, tags them and counts the rest', () => {
    const t = tandaiWilayah([fp(115.2, -8.8), fp(106.5, -6.5), fp(125.6, -8.6), fp(103.3, 5.3)], idx);
    expect(t.points.map((p) => p[6])).toEqual(['kota-a', 'kabupaten-b']);
    expect(t.points[0][7]).toBe('ID-BA');
    expect(t.luar).toBe(2);
    expect(t.luar_points.map((p) => [p[0], p[1], p[6]])).toEqual([[125.6, -8.6, undefined], [103.3, 5.3, undefined]]); // N-37: kept for smoke paths
    expect(t.per_provinsi).toEqual({ 'ID-BA': 1, 'ID-JB': 1 });
  });
  it('counts per province with names, largest first', () => {
    const pts = tandaiWilayah([fp(115.2, -8.8), fp(106.5, -6.5), fp(106.6, -6.4)], idx).points;
    expect(perProvinsi(pts)).toEqual([{ iso: 'ID-JB', nama: 'Jawa Barat', n: 2 }, { iso: 'ID-BA', nama: 'Bali', n: 1 }]);
    expect(Object.keys(PROVINSI)).toHaveLength(38);
  });
});

describe('N-12 lapor warga', () => {
  it('has the six kinds of the plan', () => {
    expect(JENIS_LAPOR.map((j) => j.id)).toEqual(['sampah', 'lahan', 'kendaraan', 'usaha', 'debu', 'lainnya']);
  });
  it('rounds the place to 3 decimals and caps the note', () => {
    const b = laporBody({ jenis: 'sampah', lat: -6.595123, lng: 106.799871, catatan: ` ${'x'.repeat(300)} ` }, 'ab'.repeat(16));
    expect([b.p_lat, b.p_lng]).toEqual([-6.595, 106.8]);
    expect(b.p_catatan).toHaveLength(280);
    expect(b.p_uji).toBe(false);
  });
  it('keeps one random device id per phone', () => {
    const m = new Map<string, string>();
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    const a = perangkatId(store);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(perangkatId(store)).toBe(a);
    expect(perangkatId(null)).not.toBe(a);
  });
  it('calls lapor_kirim over REST and reports network failures', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ ok: true, sisa: 4 }), { status: 200 }));
    const r = await kirimLaporan({ jenis: 'lahan', lat: -8.6, lng: 115.2 }, { url: 'https://x.supabase.co', key: 'k', fetchFn: f as unknown as typeof fetch, perangkat: 'cd'.repeat(16) });
    expect(r).toEqual({ ok: true, sisa: 4 });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://x.supabase.co/rest/v1/rpc/lapor_kirim');
    expect(JSON.parse(String(init.body))).toMatchObject({ p_jenis: 'lahan', p_perangkat: 'cd'.repeat(16) });
    const down = await kirimLaporan({ jenis: 'lahan', lat: 0, lng: 0 }, { url: 'u', key: 'k', fetchFn: (async () => { throw new Error('x'); }) as unknown as typeof fetch });
    expect(down).toEqual({ ok: false, alasan: 'jaringan' });
    expect(await kirimLaporan({ jenis: 'lahan', lat: 0, lng: 0 }, { url: '', key: '' })).toEqual({ ok: false, alasan: 'konfigurasi' });
  });
  it('builds a text for LAPOR! with the rounded place and a map link', () => {
    const t = teksLapor({ jenis: 'sampah', lat: -6.59512, lng: 106.79987, catatan: 'tiap sore' }, new Date('2026-11-25T10:00:00Z'));
    expect(t).toContain('Pembakaran sampah di sekitar -6.595, 106.8');
    expect(t).toContain('openstreetmap.org/?mlat=-6.595&mlon=106.8');
    expect(t).toContain('Keterangan: tiap sore');
  });
  it('reads the summary and adds it up', async () => {
    const rows = [{ lat: '-6.60', lng: '106.80', jenis: 'sampah', hari: '2026-11-25', jumlah: 3, pelapor: 2 }];
    const f = (async () => new Response(JSON.stringify(rows), { status: 200 })) as unknown as typeof fetch;
    const r = await ambilRingkas({ url: 'u', key: 'k', fetchFn: f });
    expect(r?.[0].lat).toBe(-6.6);
    expect(totalRingkas(r!)).toEqual({ laporan: 3, pelapor: 2 });
  });
  it('the form shows the kinds, the privacy note and no send before a kind is chosen', () => {
    const html = renderToStaticMarkup(h(LaporSheet, { center: { lat: -6.6, lng: 106.8 }, onClose: () => {} }));
    for (const j of JENIS_LAPOR) expect(html).toContain(j.label);
    expect(html).toContain('Namamu tidak pernah ditampilkan');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Kirim laporan/);
  });
});
