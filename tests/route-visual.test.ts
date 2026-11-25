import { describe, expect, it } from 'vitest';
import { doseChip, doseRatios, schoolChip, soonChip, timeChip } from '../src/lib/route/visual';
import { schoolCostText, type RouteCard } from '../src/lib/route/summary';

const card = (o: Partial<RouteCard>): RouteCard => ({
  index: 0, label: 'x', color: '#000', km: '1,00', minutes: 10, no2: 1, pm25: 20, exh: 5, headline: '', forecastNote: null, soonHint: null,
  harga: null, vsFastest: null, schoolNote: null, schoolCost: null, sameNote: null, ...o,
});

describe('visual route cards (N-03)', () => {
  it('dose ratios: fastest is 1, others follow the dose change', () => {
    const cs = [card({}), card({ vsFastest: { extraTimePct: 3, extraMin: 1, no2Pct: -10, exhDosePct: -66 } }), card({ vsFastest: { extraTimePct: 0, extraMin: 0, no2Pct: 0, exhDosePct: null } })];
    expect(doseRatios(cs)).toEqual([1, 0.34, null]);
  });

  it('big chip says less, more, about the same, base or no data', () => {
    const v = (p: number | null) => card({ vsFastest: { extraTimePct: 0, extraMin: 0, no2Pct: 0, exhDosePct: p } });
    expect(doseChip(card({}), 0)).toEqual({ text: 'patokan', tone: 'base' });
    expect(doseChip(card({ exh: null }), 0).tone).toBe('none');
    expect(doseChip(v(-66), 1)).toEqual({ text: '−66% asap', tone: 'good' });
    expect(doseChip(v(12), 1)).toEqual({ text: '+12% asap', tone: 'bad' });
    expect(doseChip(v(-3), 1).text).toBe('≈ sama');
    expect(doseChip(v(null), 1).tone).toBe('none');
  });

  it('time chip only when the minutes differ', () => {
    expect(timeChip(card({}))).toBeNull();
    expect(timeChip(card({ vsFastest: { extraTimePct: 5, extraMin: 1, no2Pct: 0, exhDosePct: -10 } }))).toBe('+1 mnt');
    expect(timeChip(card({ vsFastest: { extraTimePct: -5, extraMin: -2, no2Pct: 0, exhDosePct: -10 } }))).toBe('−2 mnt');
  });

  it('school chip shortens every school-cost sentence', () => {
    expect(schoolChip(card({ schoolCost: schoolCostText({ extraM: 2690, extraS: 300, changed: true }) }))).toBe('zona sekolah +5 mnt, 2.690 m');
    expect(schoolChip(card({ schoolCost: schoolCostText({ extraM: 0, extraS: 0, changed: false }) }))).toBe('zona sekolah: tetap');
    expect(schoolChip(card({ schoolCost: schoolCostText({ extraM: 20, extraS: 10, changed: true }) }))).toBe('zona sekolah: jalan lain');
    expect(schoolChip(card({ schoolCost: schoolCostText({ extraM: -400, extraS: -120, changed: true }) }))).toBe('zona sekolah: rute berubah');
    expect(schoolChip(card({}))).toBeNull();
  });

  it('soon chip from the leave-later hint', () => {
    expect(soonChip(card({ soonHint: 'Berangkat sekitar jam 07.00 lewat rute ini: asap kendaraan 20% lebih sedikit daripada berangkat sekarang' }))).toBe('berangkat 07.00: −20%');
    expect(soonChip(card({}))).toBeNull();
  });
});
