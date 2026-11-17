import { describe, expect, it } from 'vitest';
import { layerAges } from '../src/lib/field/status';

// the Badung-Denpasar manifest of run 2026111614 (computed 14:21Z, sensors of 12:00-13:00Z), WITA = UTC+8
const m = {
  run: '2026111614', computed_at: '2026-11-16T14:21:21.556Z', valid_hour_local: 22, sensors_used: 25,
  measurement: { method: 'kriging', sensor_hour_utc: '2026-11-16T12:00:00Z' },
};

describe('age of each layer of the map', () => {
  it('exhaust is for the run hour; the background is the sensors\' last complete hour, with how long ago it ended', () => {
    const a = layerAges(m, new Date('2026-11-16T14:40:00Z'))!;
    expect(a.exhaust).toBe('Asap kendaraan: jam 22.00 (angin saat ini dan pola lalu lintas jam itu)');
    expect(a.background).toBe('Udara latar: 25 sensor warga, rata-rata jam 20.00–21.00 (selesai 100 menit lalu)');
    expect(a.stale).toBe(false);
  });

  it('a region without sensors says the background is the global model; an old manifest says data lama', () => {
    const bogor = { run: '2026111614', computed_at: '2026-11-16T14:21:00Z', valid_hour_local: 21, measurement: { method: 'none' } };
    expect(layerAges(bogor, new Date('2026-11-16T14:40:00Z'))!.background).toBe('Udara latar: model global (belum ada sensor di wilayah ini)');
    const old = layerAges(m, new Date('2026-11-16T17:00:00Z'))!;
    expect(old.stale).toBe(true);
    // 14:21Z -> 17:00Z is 2 h 39 min: says how long ago, and no longer calls that hour's wind current
    expect(old.exhaust).toBe('Data lama, dihitung 3 jam lalu. Asap kendaraan: jam 22.00 (angin dan pola lalu lintas jam itu, bukan sekarang)');
    expect(old.exhaust).not.toMatch(/saat ini/);
    expect(layerAges(m, new Date('2026-11-16T15:50:00Z'))!.exhaust).toMatch(/^Data lama, dihitung 89 menit lalu\./);
    expect(layerAges(m, new Date('2026-11-19T14:21:21Z'))!.exhaust).toMatch(/^Data lama, dihitung 3 hari lalu\./);
    expect(layerAges({ run: '2026111614' }, new Date())).toBeNull();
  });
});

describe('old reading on the AQI card (F2-14)', async () => {
  const { staleReadingNote } = await import('../src/lib/field/status');
  const t = '2026-11-17T15:24:30.723Z'; // 23.24 WITA
  it('says nothing while fresh, then the hour it describes and how long ago', () => {
    expect(staleReadingNote(t, Date.parse('2026-11-17T16:30:00Z'), 8)).toBeNull();
    expect(staleReadingNote(t, Date.parse('2026-11-17T19:30:00Z'), 8)).toBe('Data lama: keadaan jam 23.24 (4 jam lalu), bukan sekarang');
    expect(staleReadingNote(t, Date.parse('2026-11-17T17:00:00Z'), 8)).toBe('Data lama: keadaan jam 23.24 (95 menit lalu), bukan sekarang'); // 95,49 menit
    expect(staleReadingNote(t, Date.parse('2026-11-17T19:30:00Z'), 7)).toBe('Data lama: keadaan jam 22.24 (4 jam lalu), bukan sekarang'); // Kota Bogor, WIB
    expect(staleReadingNote(undefined, Date.now())).toBeNull();
    expect(staleReadingNote('bukan waktu', Date.now())).toBeNull();
  });
});
