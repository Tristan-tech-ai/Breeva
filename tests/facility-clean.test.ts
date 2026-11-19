import { describe, expect, it } from 'vitest';
import { courseReason, gateBase, mergeFacilities, sameFacilityName } from '../scripts/field/facility-clean';

describe('courses and adult education are not schools (X-W88)', () => {
  it('drops tutoring, language, music and training places mapped as schools', () => {
    expect(courseReason('Primagama Buluh Indah Denpasar', 'school')).toBe('bimbingan belajar');
    expect(courseReason('Neutron Yogyakarta', 'school')).toBe('bimbingan belajar');
    expect(courseReason('Music School - repetition studio', 'school')).toBe('kursus musik atau tari');
    expect(courseReason('English First Taman Yasmin', 'school')).toBe('kursus bahasa');
    expect(courseReason('Bali Language School Gunung Athena', 'school')).toBe('kursus bahasa');
    expect(courseReason('Eden Language Learning School', 'school')).toBe('kursus bahasa');
    expect(courseReason('Pusat Bahasa STPBI', 'school')).toBe('kursus bahasa');
    expect(courseReason('Lembaga Pendidikan dan Pelatihan Sangkuriang', 'school')).toBe('lembaga pelatihan');
    expect(courseReason('Lembaga Pendidikan Pariwisata Sanur', 'school')).toBe('lembaga pelatihan');
    expect(courseReason('Akademi Sekretari Tunas Harapan', 'school')).toBe('pendidikan tinggi');
  });

  it('keeps every name with a formal school level, and anything that is not education', () => {
    for (const n of ['SMK/SMA Pembangunan & Akademi Akuntansi Denpasar', 'SMP Ganesha Denpasar', 'SMPIT Nurul Fikri Bogor',
      'SMA Islam Terpadu Nurul Fikri Boarding School', 'SD Sekolah Pintu Cerdas', 'Australian International School',
      'Sanggar Kegiatan Belajar', 'TPA Al Hikmah', 'SLB Mentari Kita', 'Taman Rama Gandhi School', 'SD Negeri 3 Kemenuh']) {
      expect(courseReason(n, 'school'), n).toBeNull();
    }
    expect(courseReason('Saraswati School & University', 'school')).toBeNull();
    expect(courseReason('Sekolah Tinggi Pariwisata Bogor', 'school')).toBe('pendidikan tinggi');
    expect(courseReason('Politeknik Negeri Bali', 'school')).toBe('pendidikan tinggi');
    expect(courseReason('Studio Kids Preschool', 'kindergarten')).toBeNull();
    expect(courseReason('Klinik Pratama Studio Sehat', 'clinic')).toBeNull();
    expect(courseReason('', 'school')).toBeNull();
    expect(courseReason(null, 'school')).toBeNull();
  });
});

describe('gates and repeated points of one facility (X-W90)', () => {
  it('reads the facility name out of a gate point', () => {
    expect(gateBase('Gerbang Masuk/Keluar - MAN 2 Kota Bogor')).toBe('MAN 2 Kota Bogor');
    expect(gateBase('SMP Negeri 6 Kota Bogor - Gerbang Masuk dan Keluar')).toBe('SMP Negeri 6 Kota Bogor');
    expect(gateBase('Pintu Masuk SDN Polisi 1')).toBe('SDN Polisi 1');
    expect(gateBase('SD Sekolah Pintu Cerdas')).toBeNull();
    expect(gateBase('SD Negeri Cibuluh 1')).toBeNull();
  });

  it('matches names word by word, not letter by letter', () => {
    expect(sameFacilityName('MAN 1', 'MAN 1 Kota Bogor')).toBe(true);
    expect(sameFacilityName('MAN 2 Bogor', 'SMAN 2 Bogor')).toBe(false);
    expect(sameFacilityName('SMP Negeri 6 Kota Bogor', 'smp negeri 6 kota bogor')).toBe(true);
  });

  const f = (id: string, nama: string, lat: number, lon: number, no2: number, kelas = 'pendidikan') =>
    ({ id, nama, kelas, jenis: 'school', lat, lon, no2_lalin: no2, pm25_lalin: no2 / 20 });

  it('merges a gate into its school within 300 m, keeping the school name and the more exposed point', () => {
    const { items, merges } = mergeFacilities([
      f('way/1', 'SMP Negeri 6 Kota Bogor', -6.5783116, 106.7721685, 2.0),
      f('node/2', 'SMP Negeri 6 Kota Bogor - Gerbang Masuk dan Keluar', -6.5783253, 106.7717001, 2.2),
      f('way/3', 'SD Negeri Cibuluh 1', -6.57, 106.80, 38.3),
    ]);
    expect(items).toHaveLength(2);
    const smp = items.find((x) => x.id === 'way/1')!;
    expect(smp.nama).toBe('SMP Negeri 6 Kota Bogor');
    expect(smp.no2_lalin).toBe(2.2);
    expect(smp.lon).toBe(106.7717001);
    expect(merges).toEqual([{ tetap: 'way/1', nama: 'SMP Negeri 6 Kota Bogor', digabung: [{ id: 'node/2', nama: 'SMP Negeri 6 Kota Bogor - Gerbang Masuk dan Keluar', alasan: 'gerbang' }] }]);
  });

  it('keeps the fullest name when a gate links a short and a long name of one school', () => {
    const { items, merges } = mergeFacilities([
      f('node/s', 'SMP Negeri 6', -6.57835, 106.77180, 1.8),
      f('node/g', 'SMP Negeri 6 Kota Bogor - Gerbang Masuk dan Keluar', -6.5783253, 106.7717001, 2.2),
      f('way/l', 'SMP Negeri 6 Kota Bogor', -6.5783116, 106.7721685, 2.0),
    ]);
    expect(items.map((x) => [x.id, x.nama, x.no2_lalin])).toEqual([['way/l', 'SMP Negeri 6 Kota Bogor', 2.2]]);
    expect(merges[0].digabung.map((d) => d.alasan).sort()).toEqual(['gerbang', 'nama sama']);
  });

  it('never merges unnamed points by name', () => {
    const { items } = mergeFacilities([f('n/1', '(school tanpa nama)', -6.5, 106.8, 1), f('n/2', '(school tanpa nama)', -6.5001, 106.8, 2)]);
    expect(items).toHaveLength(2);
  });

  it('a gate whose school is not on the list stays, under the school name', () => {
    const { items, merges } = mergeFacilities([f('node/9', 'Gerbang Masuk/Keluar - MAN 2 Kota Bogor', -6.606, 106.808, 32)]);
    expect(items.map((x) => [x.id, x.nama])).toEqual([['node/9', 'MAN 2 Kota Bogor']]);
    expect(merges).toEqual([]);
  });

  it('one school mapped as several buildings becomes one entry; far or differently named places stay apart', () => {
    const { items, merges } = mergeFacilities([
      f('way/a', 'SMAN 2 Bogor', -6.55439, 106.79400, 0.7),
      f('way/b', 'SMAN 2 Bogor', -6.55474, 106.79397, 0.6),
      f('way/c', 'SMAN 2 Bogor', -6.55505, 106.79395, 0.6),
      f('way/d', 'SMAN 2 Cibinong', -6.52300, 106.80759, 0),
      f('way/e', 'SMAN 2 Bogor', -6.60, 106.85, 3),
      f('node/k', 'SMAN 2 Bogor', -6.55440, 106.79401, 9, 'kesehatan'),
    ]);
    expect(items.map((x) => x.id).sort()).toEqual(['node/k', 'way/a', 'way/d', 'way/e']);
    expect(merges).toHaveLength(1);
    expect(merges[0].digabung.map((d) => [d.id, d.alasan])).toEqual([['way/b', 'nama sama'], ['way/c', 'nama sama']]);
  });
});
