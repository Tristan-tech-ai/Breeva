import { describe, expect, it } from 'vitest';
import { ambilUrgensi, nilaiUrgensi, wargaMelapor, type UrgensiBaris } from '../src/lib/lapor';

const row = (lat: number, lng: number, skor: number, pelapor = 1): UrgensiBaris => ({ lat, lng, jenis: ['sampah'], pelapor, skor, terakhir: '2026-11-25' });

describe('N-25 urgency of citizen reports', () => {
  it('multiplies by 1.5 near a fire and 1.3 near a school or health facility, most urgent first', () => {
    const out = nilaiUrgensi([row(-6.6, 106.8, 1), row(-6.7, 106.9, 1), row(-6.8, 107.0, 1.2)], {
      api: [[106.82, -6.6, 5, 'h']], // 2 km from the first cell
      fasilitas: [{ lat: -6.701, lon: 106.9 }], // 110 m from the second
    });
    expect(out.map((o) => [o.lat, o.nilai, o.alasan])).toEqual([
      [-6.6, 1.5, ['titik api dalam 5 km']],
      [-6.7, 1.3, ['sekolah atau faskes dalam 300 m']],
      [-6.8, 1.2, []],
    ]);
  });
  it('adds the weighted reporters (a guest counts half)', () => {
    expect(wargaMelapor([row(0, 0, 1, 0.5), row(0, 0, 1, 1.5)])).toBe(2);
  });
  it('reads the view and turns numeric strings into numbers', async () => {
    const f = (async () => new Response(JSON.stringify([{ lat: '-6.70', lng: '106.90', jenis: ['sampah'], pelapor: '1.0', skor: '0.75', terakhir: '2026-11-25' }]), { status: 200 })) as unknown as typeof fetch;
    const r = await ambilUrgensi({ url: 'u', key: 'k', fetchFn: f });
    expect(r?.[0]).toMatchObject({ lat: -6.7, pelapor: 1, skor: 0.75 });
  });
});
