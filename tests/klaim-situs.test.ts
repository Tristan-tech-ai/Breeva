import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// N-94: claims the site cannot back up stay out of the visible text. Accuracy is only claimed from hidden-location
// tests (validasi.ts: four of four EPA targets); merchants and rewards are sample data; the map is hourly.
const read = (p: string) => readFileSync(p, 'utf8');

describe('no unsupported claims in the visible text (N-94)', () => {
  it('the layer sheet no longer says the map is calibrated with a WAQI station, and speaks Indonesian', () => {
    const s = read('src/components/map/MapLayersSheet.tsx');
    expect(s).not.toMatch(/Calibrated with nearest WAQI/);
    expect(s).not.toMatch(/'Air Quality Index'|'Concentration'|\{roadLayerMeta\.count\} roads|'Good'|'Hazardous'/);
    expect(s).toMatch(/sensor warga \(Badung–Denpasar\) atau model CAMS \(Kota Bogor, indikatif\)/);
  });

  it('the onboarding promises neither real rewards nor a reward cut it does not apply', () => {
    const s = read('src/pages/OnboardingPage.tsx');
    expect(s).not.toMatch(/Earn real rewards|redeem them at sustainable merchants|50% EcoPoints|real-time air quality/);
    expect(s).toMatch(/data contoh peragaan/);
    expect(s).toMatch(/diperbarui tiap jam/);
  });

  it('a model confidence is not called accurate, and the old field is not called calibrated', () => {
    expect(read('src/components/features/AQICard.tsx')).not.toMatch(/'Akurat'|terkalibrasi/);
    expect(read('src/lib/field/popup.ts')).not.toMatch(/terkalibrasi/);
  });

  it('the privacy page says traces are off by default and not yet used for map numbers', () => {
    const s = read('src/pages/PrivacyPage.tsx');
    expect(s).toMatch(/bawaannya mati/);
    expect(s).toMatch(/belum dipakai untuk angka peta/);
  });

  it('the forecast slider has a name and the onboarding buttons keep contrast in dark mode (N-97)', () => {
    expect(read('src/components/map/MapLayersSheet.tsx')).toMatch(/type="range"\s+aria-label="Jam prakiraan"/);
    expect(read('src/pages/OnboardingPage.tsx')).not.toMatch(/dark:bg-primary-600 text-white/);
  });

  it('the city tiles under /peta speak of air, not the US index (N-152)', () => {
    const s = read('src/pages/ExploreMapPage.tsx');
    expect(s).not.toMatch(/Lihat AQI/);
    expect(s).toMatch(/Lihat udara/);
  });
});
