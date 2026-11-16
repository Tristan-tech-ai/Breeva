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
    expect(old.exhaust.startsWith('Data lama.')).toBe(true);
    expect(layerAges({ run: '2026111614' }, new Date())).toBeNull();
  });
});
