import { describe, expect, it } from 'vitest';
import { forecastPrefetchUrl } from '../src/lib/route/departForecast';
import { loadRegionFiles } from '../src/lib/route/regionFiles';

// F1-64: a route link that names a departure gets its forecast file beside the graph, as soon as the manifest is read.
const M = { run: '2026111802', valid_hour_local: 10, forecast_runs: [{ ahead: 20, valid: '2026-11-18T22:00Z', local_hour: 7, key: 'x2026111823.bin' }] };

describe('forecastPrefetchUrl', () => {
  it('names the file exhaustOf reads for that departure (06.45 rounds to 07.00)', () => {
    expect(forecastPrefetchUrl('https://cdn', 'badung_denpasar', M, '06:45')).toBe('https://cdn/v/badung_denpasar/2026111802/x2026111823.bin');
  });
  it('asks for nothing without a departure, for the run hour itself, or for an hour without a forecast', () => {
    expect(forecastPrefetchUrl('https://cdn', 'r', M, null)).toBeNull();
    expect(forecastPrefetchUrl('https://cdn', 'r', M, '10:00')).toBeNull();
    expect(forecastPrefetchUrl('https://cdn', 'r', M, '15:00')).toBeNull();
    expect(forecastPrefetchUrl('https://cdn', 'r', { run: 'x' }, '06:45')).toBeNull();
  });
});

describe('loadRegionFiles onManifest', () => {
  it('hands over the manifest before the graph has arrived', async () => {
    let graphDone = false;
    let seen: unknown = null, graphWhenSeen: boolean | null = null;
    const get = async (url: string) => {
      if (url.endsWith('manifest.json')) return new TextEncoder().encode(JSON.stringify({ ...M, cells: [] }));
      if (url.includes('_inti2')) { await new Promise((r) => setTimeout(r, 20)); graphDone = true; }
      return new TextEncoder().encode('x');
    };
    await loadRegionFiles('/f', { name: 'r', geometry: 'g' }, get, (m) => { seen = m.run; graphWhenSeen = graphDone; });
    expect(seen).toBe('2026111802');
    expect(graphWhenSeen).toBe(false);
  });
});
