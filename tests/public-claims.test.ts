import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CITIES } from '../src/lib/cities';

// P-32: public copy (pages a visitor or a search engine sees without an account) says only what Breeva 3 does: a
// per-road field for Badung-Denpasar and Kota Bogor, recomputed hourly, routes on the phone, accuracy tested openly.
const FILES = ['src/pages/ExploreMapPage.tsx', 'src/pages/CityAirPage.tsx', 'src/pages/LandingPage.tsx', 'src/pages/AboutPage.tsx',
  'src/pages/HelpPage.tsx', 'src/pages/DeveloperLandingPage.tsx', 'src/lib/cities.ts', 'prerender-routes.mjs'];
const STALE = [/real-time per ruas/i, /AQI per-jalan real-time/i, /akurat hingga tiap ruas/i, /Tiga pilihan rute/i, /tiga rute/i, /Prakiraan 24 Jam/i,
  /prakiraan 24 jam/i, /Kalibrasi ML/, /kalibrasi machine-learning/i, /mengkalibrasi AQI/i, /Grab a free key/i, /Jakarta, Bali, Bandung, Surabaya & kota Indonesia/,
  /Hijau = Rute Bersih/, /Sepeda, Motor, dan Mobil/];

describe('public claims (P-32)', () => {
  it('no stale or unsupported claim in the public pages and the prerendered HTML source', () => {
    const hits = FILES.flatMap((f) => { const s = readFileSync(f, 'utf8'); return STALE.filter((r) => r.test(s)).map((r) => `${f}: ${r}`); });
    expect(hits).toEqual([]);
  });

  it('only the city with the per-road field claims per-road maps and routes', () => {
    expect(CITIES.filter((c) => c.perRoad).map((c) => c.slug)).toEqual(['bali']);
    for (const c of CITIES.filter((x) => !x.perRoad)) expect(c.blurb).not.toMatch(/ruas jalan|per jalan|rute|real-time/i);
    const pre = readFileSync('prerender-routes.mjs', 'utf8');
    expect((pre.match(/perRoad: true/g) ?? []).length).toBe(1);
  });
});
