import { describe, expect, it } from 'vitest';
import { csvTitik, jenisKata, kalimatTitik, warnaKabut, type DataTitik, type TitikSensor } from '../src/lib/sensorTitik';

const t: TitikSensor = {
  peringkat: 1, nama: 'Sekolah Luar Biasa A Negeri Denpasar', jenis: 'school', lat: -8.67, lon: 115.22, dJ_marginal_pct: 11.8, dJ_kumulatif_pct: 11.8,
  bangunan_baru_1km_m2: 500000, bangunan_baru_1km_pct_wilayah: 1.2, fasilitas_baru_1km: 7, e_sekitar_1km_sebelum: 17.4, e_sekitar_1km_sesudah: 9.1, jarak_sensor_terdekat_km: 3.97,
};

describe('M-T06 halaman titik sensor', () => {
  it('kalimat titik dalam bahasa orang, angka format Indonesia', () => {
    expect(kalimatTitik(t)).toBe('Membuka 11,8% kabut kebutaan wilayah ini; 1,2% bangunan wilayah baru masuk 1 km dari sensor; 7 sekolah dan faskes baru dalam 1 km; galat perkiraan per jam di sekitarnya turun dari 17,4 ke 9,1 µg/m³; sensor terdekat 4,0 km.');
    expect(kalimatTitik({ ...t, jarak_sensor_terdekat_km: null, fasilitas_baru_1km: 0, bangunan_baru_1km_pct_wilayah: 0 })).toMatch(/belum ada sensor lain di wilayah ini\.$/);
  });
  it('CSV dengan kepala, tanda kutip bila perlu, dan label', () => {
    const d = { titik: [{ ...t, nama: 'SD "Satu", Kuta' }], label: 'indikatif' } as unknown as DataTitik;
    const c = csvTitik(d).split('\n');
    expect(c[0]).toBe('peringkat,nama,jenis,lat,lon,kabut_terbuka_pct,kumulatif_pct,bangunan_baru_1km_pct,fasilitas_baru_1km,galat_sebelum_ug_m3,galat_sesudah_ug_m3,sensor_terdekat_km,label');
    expect(c[1]).toBe('1,"SD ""Satu"", Kuta",sekolah,-8.67,115.22,11.8,11.8,1.2,7,17.4,9.1,3.97,indikatif');
  });
  it('jenis dan warna kabut', () => {
    expect(jenisKata('kantor_desa')).toBe('kantor desa/kelurahan');
    expect(jenisKata('lain')).toBe('lain');
    expect(warnaKabut(0)).toBeNull();
    expect(warnaKabut(255)).toBe('rgba(194,38,6,0.85)');
  });
});
