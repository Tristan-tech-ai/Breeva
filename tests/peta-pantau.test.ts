import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { bentukPanah, gayaApi, opasitasPanah, panahAngin, radiusApi, teksApi } from '../src/lib/nasional/petaPantau';
import { GRID, type WindFile } from '../src/lib/nasional/angin';
import type { FirePoint } from '../src/lib/nasional/firms';

const api = (o: Partial<{ frp: number; conf: string; slug?: string }> = {}): FirePoint =>
  [110, -2, o.frp ?? 16, o.conf ?? 'h', '2026-11-25T06:00Z', 'N20', 'slug' in o ? o.slug : 'kota-x', 'ID-KT'];

describe('N-40 /pantau map on canvas', () => {
  it('keeps the fire colours, sizes and texts of the SVG map', () => {
    expect(gayaApi(api(), true).fillColor).toBe('#dc2626');
    expect(gayaApi(api({ conf: 'n' }), true).fillColor).toBe('#f97316');
    expect(gayaApi(api({ slug: undefined }), true).fillColor).toBe('#94a3b8'); // outside Indonesia, grey
    expect(gayaApi(api({ slug: undefined }), false).fillColor).toBe('#dc2626');
    expect(radiusApi(api({ frp: 16 }))).toBe(4.5);
    expect(radiusApi(api({ frp: 10000 }))).toBe(9);
    expect(teksApi(api({ slug: undefined }), true)).toMatch(/^Di luar Indonesia · Titik api 2026-11-25 06:00 UTC · daya 16 MW · keyakinan tinggi$/);
  });

  it('reads one hour of wind per grid point and skips missing values', () => {
    const n = GRID.nx * GRID.ny;
    const wind = { speed: Array.from({ length: n }, (_, k) => (k === 1 ? [null] : [3])), dir: Array.from({ length: n }, () => [90]) } as unknown as WindFile;
    const p = panahAngin(wind, 0);
    expect(p).toHaveLength(n - 1);
    expect(p[0]).toEqual({ lat: GRID.lat0, lon: GRID.lon0, from: 90, speed: 3 });
    expect(panahAngin(null, 0)).toEqual([]);
  });

  it('points the arrow where the wind blows to, in screen pixels', () => {
    // wind from the east (90) blows west: the tip is left of the centre, at half the length
    const [tail, tip] = bentukPanah(100, 100, 90, 14);
    expect(tip[0]).toBeCloseTo(93, 5); expect(tip[1]).toBeCloseTo(100, 5);
    expect(tail[0]).toBeCloseTo(107, 5);
    // wind from the north (0) blows south: down the screen
    expect(bentukPanah(0, 0, 0, 10)[1][1]).toBeCloseTo(5, 5);
    expect(opasitasPanah(0)).toBeCloseTo(0.35, 5);
    expect(opasitasPanah(20)).toBe(0.9);
  });

  it('draws on canvas and builds layers once per data object (no SVG per point, no DOM marker per wind arrow)', () => {
    const src = readFileSync('src/components/pantau/PantauMap.tsx', 'utf8');
    expect(src).toContain('preferCanvas');
    expect(src).not.toMatch(/<(CircleMarker|Marker|Polyline|GeoJSON)[\s/>]|L\.divIcon/);
    expect(src).toContain('export default memo(PantauMap)');
    expect(src).toContain('vector={false}'); // raster basemap on the monitoring maps (N-41)
    expect(src).toContain('{...PETA_HEMAT}');
    for (const page of ['src/pages/PantauPage.tsx', 'src/components/pantau/KabKotaView.tsx', 'src/pages/SensorPage.tsx']) {
      const p = readFileSync(page, 'utf8');
      // no array or object literal built inline in a PantauMap prop (a new identity per render rebuilds the layers)
      const calls = p.match(/<PantauMap[^>]*\/>/gs) ?? [];
      expect(calls.length).toBeGreaterThan(0);
      for (const c of calls) expect(c, `${page}: ${c}`).not.toMatch(/=\{\[|=\{\{|\.map\(|\?\? \[\]/);
    }
  });
});
