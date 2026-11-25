import { describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { scFile } from '../src/lib/nasional/sensorCommunity';
import { ambilSensorPublik, contohCurl, contohEsphome, TIPE_SENSOR } from '../src/lib/sensorSendiri';
import SensorPage from '../src/pages/SensorPage';

const entry = (id: number, t: string, vals: Record<string, string>, lat = '-8.45908851403', lon = '114.31825649675') => ({
  timestamp: t, location: { latitude: lat, longitude: lon, indoor: 0 }, sensor: { id, sensor_type: { name: 'SDS011' } },
  sensordatavalues: Object.entries(vals).map(([value_type, value]) => ({ value_type, value })),
});

describe('N-27 own and open sensors', () => {
  it('keeps the newest PM reading per Sensor.Community sensor, rounded to 3 decimals, without temperature-only sensors', () => {
    const f = scFile([
      entry(94079, '2026-11-25 12:02:00', { P1: '40', P2: '30' }),
      entry(94079, '2026-11-25 12:07:56', { P1: '45', P2: '37', temperature: '25.7' }),
      entry(5, '2026-11-25 12:07:00', { temperature: '25', humidity: '70' }),
      entry(6, '2026-11-25 12:07:00', { P2: '5000' }),
    ], new Date('2026-11-25T12:10:00Z'));
    expect(f.sensors).toEqual([{ id: 94079, lat: -8.459, lon: 114.318, pm25: 37, pm10: 45, t: '2026-11-25T12:07:56Z', tipe: 'SDS011', dalam: false }]);
    expect(f.lisensi).toBe('DbCL 1.0');
  });
  it('gives a curl and an ESPHome example that call sensor_kirim with the token', () => {
    const c = contohCurl('https://x.supabase.co', 'anon', 'ab'.repeat(24));
    expect(c).toContain("'https://x.supabase.co/rest/v1/rpc/sensor_kirim'");
    expect(c).toContain('"p_token":"' + 'ab'.repeat(24) + '"');
    expect(contohEsphome('https://x.supabase.co', 'anon', 'cd'.repeat(24))).toContain('p_pm25: !lambda return id(pm25).state;');
    expect(TIPE_SENSOR.map((t) => t.id)).toEqual(['http', 'airgradient', 'sensor_community']);
  });
  it('reads the public view', async () => {
    const f = (async () => new Response(JSON.stringify([{ id: 'a', nama: 'Teras', tipe: 'http', lat: '-8.650', lng: '115.220', pm25: 20, waktu: null }]), { status: 200 })) as unknown as typeof fetch;
    expect((await ambilSensorPublik({ url: 'u', key: 'k', fetchFn: f }))?.[0]).toMatchObject({ lat: -8.65, lng: 115.22 });
  });
  it('the page says the sensors are not used by the model and asks guests to sign in before registering', () => {
    const html = renderToStaticMarkup(h(MemoryRouter, null, h(SensorPage)));
    expect(html).toContain('tidak dipakai model');
    expect(html).toContain('Masuk dulu supaya sensor tercatat');
    for (const t of TIPE_SENSOR) expect(html).toContain(t.label);
  });
});
