import { describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CCTV_LABEL, cctvBasi, cctvDekat, kameraKabKota, ringkasCctv, teksCctv, warnaCctv, type CctvFile, type CctvKamera } from '../src/lib/nasional/cctv';
import CctvRingkas from '../src/components/pantau/CctvRingkas';

const kam = (o: Partial<CctvKamera>): CctvKamera => ({
  id: 'a', kota: 'kota_bogor', nama: 'Jl. Pajajaran', lat: -6.6, lon: 106.8, status: 'ok', total: 5, rata_jam: 4.3, indeks: 1.6, tingkat: 'padat', ...o,
});
const file: CctvFile = {
  format: 'cctv_publik', updated_at: '2026-11-25T14:00:00Z', label: CCTV_LABEL, model: 'YOLOX-s', catatan: 'Belum masuk angka peta.',
  kamera: [
    kam({}),
    kam({ id: 'b', tingkat: null, indeks: null, total: 2, rata_jam: 2 }),
    kam({ id: 'c', status: 'buram', total: null, rata_jam: null, indeks: null, tingkat: null }),
    kam({ id: 'd', kota: 'kota_bandung', nama: 'Jl. Asia Afrika', lat: -6.92, lon: 107.61, status: 'offline', total: null, rata_jam: null, indeks: null, tingkat: null }),
  ],
};

describe('N-35 traffic-camera layer', () => {
  it('colours by the density level, teal before 3 hours of runs, grey without a picture', () => {
    expect(warnaCctv(file.kamera[0])).toBe('#dc2626');
    expect(warnaCctv(file.kamera[1])).toBe('#0f766e');
    expect(warnaCctv(file.kamera[2])).toBe('#94a3b8');
    expect(warnaCctv(file.kamera[3])).toBe('#94a3b8');
  });
  it('tooltips say what was seen, and never claim a level without history', () => {
    expect(teksCctv(file.kamera[0])).toBe('Jl. Pajajaran · 5 kendaraan terlihat, rata-rata jam terakhir 4,3 · padat dibanding jam yang sama kemarin');
    expect(teksCctv({ ...file.kamera[0], biasa_jam_ini: 2.5 })).toContain('padat dibanding jam yang sama kemarin, biasanya 2,5 pada jam ini');
    expect(teksCctv(file.kamera[1])).toContain('belum ada data jam yang sama kemarin');
    expect(teksCctv(file.kamera[2])).toContain('buram');
    expect(teksCctv(file.kamera[3])).toContain('tidak menayangkan');
  });
  it('finds the cameras near a place and sums per city', () => {
    expect(cctvDekat(file, -6.59, 106.79, 25).map((k) => k.id)).toEqual(['a', 'b', 'c']);
    expect(cctvDekat(null, 0, 0, 25)).toEqual([]);
    expect(kameraKabKota(file, 'kota-bogor').map((k) => k.id)).toEqual(['a', 'b', 'c']);
    expect(kameraKabKota(file, 'kabupaten-bogor')).toEqual([]);
    expect(kameraKabKota(file, 'kota-bandung').map((k) => k.id)).toEqual(['d']);
    const r = ringkasCctv(file.kamera);
    expect(r[0]).toEqual({ kota: 'kota_bogor', nama: 'Kota Bogor', kamera: 3, ok: 2, kendaraan: 7, padat: 1, mati: 0 });
    expect(r[1]).toMatchObject({ kota: 'kota_bandung', ok: 0, kendaraan: 0 });
  });
  it('is stale after an hour without a run', () => {
    expect(cctvBasi(file, Date.parse('2026-11-25T14:50:00Z'))).toBe(false);
    expect(cctvBasi(file, Date.parse('2026-11-25T15:01:00Z'))).toBe(true);
    expect(cctvBasi(null)).toBe(true);
  });
  it('the summary card carries the trial label, the update time and no picture', () => {
    const html = renderToStaticMarkup(h(CctvRingkas, { file, kamera: file.kamera }));
    expect(html).toContain(CCTV_LABEL);
    expect(html).toContain('data-cctv');
    expect(html).toContain('Kota Bogor');
    expect(html).toMatch(/21[.:]00/); // 14.00 UTC = 21.00 WIB
    expect(html).not.toMatch(/<img|<video|m3u8/);
  });
});

describe('a city whose camera server did not answer (N-119)', () => {
  it('says so instead of 0 cameras read and 0 vehicles', async () => {
    const { barisKota, ringkasCctv } = await import('../src/lib/nasional/cctv');
    const k = (id: string, kota: string, status: string, total?: number) => ({ id, kota, status, total }) as never;
    const rows = ringkasCctv([k('1', 'kota_bogor', 'offline'), k('2', 'kota_bogor', 'offline'), k('3', 'kota_bandung', 'ok', 4), k('4', 'kota_bandung', 'offline')]);
    const bogor = rows.find((r) => r.kota === 'kota_bogor')!, bandung = rows.find((r) => r.kota === 'kota_bandung')!;
    expect(barisKota(bogor)).toMatch(/server kamera kota ini tidak menjawab pada run terakhir \(2 kamera\)/);
    expect(barisKota(bandung)).toMatch(/1 dari 2 kamera terbaca, 4 kendaraan terlihat/);
    // all blurred at night is not a silent server
    const malam = ringkasCctv([k('5', 'kota_bogor', 'buram'), k('6', 'kota_bogor', 'buram')]);
    expect(barisKota(malam[0])).toMatch(/0 dari 2 kamera terbaca/);
  });
});
