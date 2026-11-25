import { describe, expect, it } from 'vitest';
import { fasilitasCsv, kmBetween, nearby, perPulau, pulauOf } from '../src/lib/nasional/pantau';
import type { FirePoint } from '../src/lib/nasional/firms';
import type { Fasilitas } from '../src/lib/prioritas';

const f = (lon: number, lat: number): FirePoint => [lon, lat, 10, 'n', '2026-11-25T05:00Z', 'N20'];

describe('pantau helpers (N-11)', () => {
  it('puts points on the right island', () => {
    expect(pulauOf(113.9, -2.1)).toBe('Kalimantan');
    expect(pulauOf(104.7, -3)).toBe('Sumatra');
    expect(pulauOf(106.8, -6.6)).toBe('Jawa');
    expect(pulauOf(115.2, -8.65)).toBe('Bali dan Nusa Tenggara');
    expect(pulauOf(80, 0)).toBe('Lainnya');
  });
  it('counts per island, largest first', () => {
    expect(perPulau([f(113.9, -2.1), f(114, -2), f(104.7, -3)])).toEqual([{ nama: 'Kalimantan', n: 2 }, { nama: 'Sumatra', n: 1 }]);
  });
  it('distance and nearby points', () => {
    expect(kmBetween(-6.595, 106.79, -6.2, 106.8)).toBeCloseTo(43.9, 0);
    const near = nearby([f(106.8, -6.2), f(113.9, -2.1)], -6.595, 106.79, 150);
    expect(near).toHaveLength(1);
    expect(Math.round(near[0].km)).toBe(44);
  });
  it('CSV quotes names and starts with a BOM', () => {
    const x = { peringkat: 1, nama: 'SD "Satu", Bogor', jenis: 'school', lat: -6.5, lon: 106.7, no2_lalin: 12.3, pm25: 40, jam_puncak: 7, jalan_terdekat: 'Jl. A', d_major_m: 80 } as unknown as Fasilitas;
    const csv = fasilitasCsv([x]);
    expect(csv.startsWith('\ufeffperingkat,nama')).toBe(true);
    expect(csv).toContain('1,"SD ""Satu"", Bogor","school",-6.5,106.7,12.3,40,7,"Jl. A",80');
  });
});
